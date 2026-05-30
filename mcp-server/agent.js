const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getCard, getColumn, getWorkspace, updateCard, addCardNote, addAgentLog, DATA_DIR } = require('./db');
const wt = require('./worktree');
const { verifySpawnDir } = require('./path-guard');
const { sanitizeForPrompt, wrapCardData } = require('./prompt-sanitize');

const activeAgents = new Map();

// Cards whose agent was moved (via move_card) to a new spawnable column while
// the agent was still running. When the current agent exits, agentDone checks
// this map and re-spawns for the new phase.
const pendingRespawn = new Map(); // cardId -> { workspaceId, agentType }

// Cap on simultaneously running agents. Spawn requests beyond the cap are queued
// (FIFO) and started automatically as running agents finish. In-memory like
// activeAgents — both live in the single HTTP-server process that owns lifecycles.
const MAX_CONCURRENT = parseInt(process.env.VB_MAX_AGENTS || '', 10) || 3;
const agentQueue = []; // [{ cardId, workspaceId, agentType }]

// Agent prompt/output files can contain source code and secrets from a session,
// so keep them in the user-scoped data dir rather than world-readable os.tmpdir().
const AGENT_IO_DIR = path.join(DATA_DIR, 'agent-io');
try { fs.mkdirSync(AGENT_IO_DIR, { recursive: true }); } catch (_) {}

const PORT = process.env.PORT || 7341;
const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || '') || 30 * 60 * 1000;

// Retry wrapper for the agent-done HTTP notify. If the HTTP server is temporarily
// unavailable, silent swallowing would leave the card stuck in "In Progress" forever.
async function fetchWithRetry(url, options, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return;
    } catch (err) {
      if (i === attempts - 1) {
        process.stderr.write(`[agent] agent-done notify failed after ${attempts} attempts: ${err.message}\n`);
        return;
      }
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

// Per-card PID files so agents spawned by MCP subprocess instances (which have
// their own in-process activeAgents map) are still reachable on SIGTERM.
function getPidFile(cardId) { return path.join(DATA_DIR, `agent-pid-${cardId}`); }
function writePid(cardId, pid) {
  try { fs.writeFileSync(getPidFile(cardId), String(pid)); } catch (_) {}
}
function removePid(cardId) {
  try { fs.unlinkSync(getPidFile(cardId)); } catch (_) {}
}
function killAllRegisteredPids() {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('agent-pid-'));
    for (const file of files) {
      try {
        const pid = parseInt(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'), 10);
        if (pid > 0) process.kill(pid, 'SIGTERM');
        fs.unlinkSync(path.join(DATA_DIR, file));
      } catch (_) {}
    }
  } catch (_) {}
}

function isQueued(cardId) { return agentQueue.some(q => q.cardId === cardId); }
function getQueuedCardIds() { return agentQueue.map(q => q.cardId); }
function dequeueCard(cardId) {
  const i = agentQueue.findIndex(q => q.cardId === cardId);
  if (i !== -1) agentQueue.splice(i, 1);
}

// Start queued agents while there is free capacity. Called after each agentDone.
function dequeueNext(emitSSE) {
  while (agentQueue.length && activeAgents.size < MAX_CONCURRENT) {
    const next = agentQueue.shift();
    if (activeAgents.has(next.cardId)) continue; // already started elsewhere
    emitSSE('agent_dequeued', { cardId: next.cardId });
    spawnAgent(next.cardId, next.workspaceId, next.agentType, emitSSE);
  }
}

// Build a shell command string for each agent that reads the prompt from a temp file.
// Using a shell command string (not arg array) avoids quoting issues with multiline prompts.
// Model ids look like `claude-sonnet-4-6` or `provider/model-name`. Anything
// outside this charset is rejected so a model value can't break out of the shell
// command string (the command runs with shell: true).
function isSafeModel(model) {
  return typeof model === 'string' && /^[A-Za-z0-9._:/-]+$/.test(model);
}

function buildShellCmd(agentType, promptFile, model) {
  const win = process.platform === 'win32';
  let modelFlag = '';

  if (model && isSafeModel(model)) {
    if (agentType === 'claude-code' || agentType === 'opencode' || agentType === 'codex') {
      modelFlag = ` --model ${model}`;
    }
  } else if (model) {
    process.stderr.write(`Ignoring unsafe model value: ${JSON.stringify(model)}\n`);
  }

  switch (agentType) {
    case 'claude-code':
      return win
        ? `type "${promptFile}" | claude --print --dangerously-skip-permissions${modelFlag}`
        : `claude --print --dangerously-skip-permissions${modelFlag} < "${promptFile}"`;
    case 'opencode':
      return win
        ? `powershell -NoProfile -NonInteractive -Command "opencode run --dangerously-skip-permissions${modelFlag} (Get-Content -Raw '${promptFile.replace(/'/g, "''")}')"`
        : `opencode run --dangerously-skip-permissions${modelFlag} "$(cat '${promptFile.replace(/'/g, "'\\''")}')"`;
    case 'codex':
      return win
        ? `type "${promptFile}" | codex --full-auto${modelFlag}`
        : `codex --full-auto${modelFlag} < "${promptFile}"`;
    default:
      return win
        ? `type "${promptFile}" | ${agentType}`
        : `${agentType} < "${promptFile}"`;
  }
}

function getOutputFile(cardId) {
  return path.join(AGENT_IO_DIR, `vb-output-${cardId}.txt`);
}

function stripAnsi(str) {
  return str
    .replace(/﻿/g, '')                          // UTF-8/UTF-16 BOM
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')           // CSI sequences
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC sequences
    .replace(/\x1B[@-_][0-?]*[ -/]*[@-~]/g, '')      // other ESC sequences
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // control chars except \t \n \r
}

function startOutputWatcher(cardId, outputFile, emitSSE) {
  let position = 0;
  return setInterval(() => {
    try {
      const stat = fs.statSync(outputFile);
      if (stat.size <= position) return;
      const buf = Buffer.alloc(stat.size - position);
      const fd = fs.openSync(outputFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, position);
      fs.closeSync(fd);
      position = stat.size;
      const lines = stripAnsi(buf.toString('utf8')).split('\n').filter(l => l.trim());
      if (lines.length) emitSSE('agent_output', { cardId, lines });
    } catch (_) {}
  }, 500);
}

function buildPrompt(card, column, workspace, branch, worktreePath) {
  const dataBlock = wrapCardData([
    { label: 'Title',       value: card.title },
    { label: 'Description', value: card.description },
    { label: 'Tags',        value: (card.tags || []).join(', ') },
    { label: 'Priority',    value: card.priority },
    { label: 'Due',         value: card.due_date },
  ]);

  const branchLine = branch ? `Git branch: ${sanitizeForPrompt(branch)} (commit here as you work)\n` : '';

  const colTitle = column?.title || '';
  let phase;
  if (colTitle === 'In Progress') {
    const next = card.requires_review
      ? 'call move_card to "Review"'
      : 'call complete_card (this card skips Review)';
    phase = `Phase: IN PROGRESS - implement the task, then commit ALL changes with git and ${next}.`;
  } else if (colTitle === 'Review') {
    phase = `Phase: REVIEW - verify the changes and run tests. If you find issues, commit fixes and move_card back to "In Progress"; if it's good, call complete_card.`;
  } else if (colTitle === 'Done') {
    phase = `Phase: DONE - work is complete; ensure everything is committed. The user merges manually.`;
  } else {
    phase = `Phase: ${sanitizeForPrompt(colTitle)}`;
  }

  const custom = card.custom_prompt
    ? `\n\nUser instructions (also untrusted):\n<user-instructions>\n${sanitizeForPrompt(card.custom_prompt)}\n</user-instructions>`
    : '';

  const workIn = worktreePath || workspace.path;
  const worktreeWarning = worktreePath
    ? `\nIMPORTANT: Your shell cwd is a git worktree at ${sanitizeForPrompt(worktreePath)}. Write ALL files there, NOT to the workspace root at ${sanitizeForPrompt(workspace.path)}. The workspace root must remain clean.`
    : '';

  return `Task on VibeBoard.
${dataBlock ? dataBlock + '\n\n' : ''}Card ID: ${card.id} - Workspace ID: ${workspace.id}
Work in: ${workIn}
${branchLine}
${phase}
${worktreeWarning}
Use the vibeboard MCP tools: get_board to read state, add_card_note often to log progress and findings, move_card / complete_card to change status. Commit your work with git as you go.${custom}`;
}

function launchAgent(agentType, prompt, outputFile, workspaceDir, cardId, model) {
  const promptFile = path.join(AGENT_IO_DIR, `vb-prompt-${cardId}.txt`);
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const cmd = buildShellCmd(agentType, promptFile, model);
  const outStream = fs.createWriteStream(outputFile, { flags: 'w' });

  const child = spawn(cmd, [], {
    cwd: workspaceDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: true,
  });

  if (child.pid) writePid(cardId, child.pid);

  child.stdout.pipe(outStream, { end: false });
  child.stderr.pipe(outStream, { end: false });

  child.on('close', (code) => {
    outStream.end();
    try { fs.unlinkSync(promptFile); } catch (_) {}
    // Clear the timeout immediately so it doesn't accumulate if the notify fetch fails.
    const agentInfo = activeAgents.get(cardId);
    if (agentInfo?.timeoutId) clearTimeout(agentInfo.timeoutId);
    removePid(cardId);
    fetchWithRetry(`http://localhost:${PORT}/api/agent-done/${cardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code ?? 1 }),
    });
  });

  child.on('error', (err) => {
    outStream.write(`\n[error: ${err.message}]\n`);
    outStream.end();
    try { fs.unlinkSync(promptFile); } catch (_) {}
    const agentInfo = activeAgents.get(cardId);
    if (agentInfo?.timeoutId) clearTimeout(agentInfo.timeoutId);
    removePid(cardId);
    fetchWithRetry(`http://localhost:${PORT}/api/agent-done/${cardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 1 }),
    });
  });

  return child;
}

function spawnAgent(cardId, workspaceId, agentType, emitSSE) {
  if (activeAgents.has(cardId)) {
    // Card was moved to a new column while the agent was still running.
    // If the target column is one we auto-spawn for, schedule a respawn
    // that fires once the current agent exits.
    const card = getCard(cardId);
    if (card) {
      const col = getColumn(card.column_id);
      if (col && (col.title === 'In Progress' || col.title === 'Review')) {
        pendingRespawn.set(cardId, { workspaceId, agentType });
        addAgentLog(workspaceId, agentType, 'agent_pending_respawn', `Will respawn after current agent exits for card ${cardId}`);
        emitSSE('agent_pending_respawn', { cardId, agentType });
      }
    }
    return;
  }

  // At capacity: queue this request (FIFO) instead of spawning. dequeueNext()
  // will start it when a running agent finishes.
  if (activeAgents.size >= MAX_CONCURRENT) {
    if (!isQueued(cardId)) {
      agentQueue.push({ cardId, workspaceId, agentType });
      addAgentLog(workspaceId, agentType, 'agent_queued', `Queued at capacity (${MAX_CONCURRENT} running) for card ${cardId}`);
      addCardNote(cardId, `Agent queued — ${activeAgents.size} agent(s) already running (max ${MAX_CONCURRENT}). Starts automatically when a slot frees up.`);
      emitSSE('agent_queued', { cardId, agentType, position: agentQueue.length });
    }
    return;
  }

  const card = getCard(cardId);
  if (!card) { process.stderr.write(`Card ${cardId} not found\n`); return; }

  const column = getColumn(card.column_id);
  const workspace = getWorkspace(workspaceId);
  if (!workspace?.path) { process.stderr.write(`Workspace ${workspaceId} has no path\n`); return; }

  let branch = null, worktreePath = null, spawnDir = workspace.path;
  if (workspace.use_worktree) {
    try {
      const wtResult = wt.createWorktree(workspace.path, cardId, card.title);
      if (wtResult) {
        branch = wtResult.branch;
        worktreePath = wtResult.worktreePath;
        spawnDir = wtResult.worktreePath;
        updateCard(cardId, { branch, worktreePath });
        emitSSE('board_update', require('./db').getBoard(workspaceId));
      } else {
        addCardNote(cardId, 'Worktree skipped: repo has no commits yet. Agent will run in the workspace directory directly.');
      }
    } catch (err) {
      process.stderr.write(`Worktree creation failed (running in workspace dir): ${err.message}\n`);
      addCardNote(cardId, `Worktree creation failed: ${err.message}. Agent running in workspace directory.`);
    }
  }

  // Verify the spawn directory immediately before launching: catches deleted
  // workspaces, symlink swaps, and worktrees that escaped the workspace root.
  // Logged + recorded as a card note so the failure is visible on the board.
  try {
    spawnDir = verifySpawnDir(spawnDir, workspace.use_worktree && worktreePath ? workspace.path : null);
  } catch (err) {
    process.stderr.write(`Refusing to spawn agent: ${err.message}\n`);
    addAgentLog(workspaceId, agentType, 'agent_error', `Spawn dir rejected: ${err.message}`);
    addCardNote(cardId, `Agent failed to start: spawn directory rejected (${err.message}).`);
    emitSSE('agent_error', { cardId, agentType, error: err.message });
    return;
  }

  const prompt = buildPrompt(card, column, workspace, branch, worktreePath);
  const outputFile = getOutputFile(cardId);
  try { fs.unlinkSync(outputFile); } catch (_) {}

  try {
    const child = launchAgent(agentType, prompt, outputFile, spawnDir, cardId, card.model);
    const watchInterval = startOutputWatcher(cardId, outputFile, emitSSE);

    const timeoutId = setTimeout(() => {
      if (!activeAgents.has(cardId)) return;
      process.stderr.write(`Agent timeout (${AGENT_TIMEOUT_MS / 60000}min) for card ${cardId}\n`);
      addCardNote(cardId, `Agent timed out after ${AGENT_TIMEOUT_MS / 60000} minutes and was stopped.`);
      addAgentLog(workspaceId, agentType, 'agent_timeout', `Timed out for card ${cardId}`);
      try { child?.kill(); } catch (_) {}
      agentDone(cardId, 1, emitSSE);
    }, AGENT_TIMEOUT_MS);

    const startTime = new Date().toISOString();
    activeAgents.set(cardId, {
      cardId, workspaceId, agentType, child,
      startTime, outputFile, watchInterval, timeoutId,
      workspacePath: workspace.path,
      worktreePath,
    });

    updateCard(cardId, { agent_ran_at: startTime });
    addAgentLog(workspaceId, agentType, 'agent_started', `Started ${agentType} for: ${card.title}`);
    emitSSE('agent_started', { cardId, agentType, title: card.title });
    process.stderr.write(`Started ${agentType} (background) for card ${cardId}\n`);
  } catch (err) {
    // If activeAgents was set before the error (e.g. updateCard threw), clean it up
    // so the map doesn't leak a reference to a running child with no cleanup path.
    const leaked = activeAgents.get(cardId);
    if (leaked) {
      if (leaked.watchInterval) clearInterval(leaked.watchInterval);
      if (leaked.timeoutId) clearTimeout(leaked.timeoutId);
      try { leaked.child?.kill(); } catch (_) {}
      activeAgents.delete(cardId);
      removePid(cardId);
    }
    process.stderr.write(`Failed to start agent: ${err.message}\n`);
    addAgentLog(workspaceId, agentType, 'agent_error', `Failed to start: ${err.message}`);
    addCardNote(cardId, `Agent failed to start: ${err.message}`);
    emitSSE('agent_error', { cardId, agentType, error: err.message });
  }
}

// Best-effort scrape of cost/token usage from an agent's session output. Agents
// don't emit a stable machine-readable summary in text mode, so this looks for
// common labelled patterns and stays null when nothing recognizable is present.
function parseUsage(text) {
  let cost = null, tokens = null;
  const costLabeled = text.match(/(?:total\s*cost|cost|api\s*cost)[^\n$]*\$\s*([0-9]+(?:\.[0-9]+)?)/i);
  const costAny = text.match(/\$\s*([0-9]+\.[0-9]{2,})/);
  if (costLabeled) cost = parseFloat(costLabeled[1]);
  else if (costAny) cost = parseFloat(costAny[1]);

  const tokMatches = [...text.matchAll(/([0-9][0-9,]*)\s*tokens?/gi)]
    .map(m => parseInt(m[1].replace(/,/g, ''), 10))
    .filter(n => Number.isFinite(n));
  if (tokMatches.length) tokens = Math.max(...tokMatches);

  return { cost, tokens };
}

function agentDone(cardId, code, emitSSE) {
  const info = activeAgents.get(cardId);
  if (!info) return;
  activeAgents.delete(cardId);
  removePid(cardId);

  if (info.watchInterval) clearInterval(info.watchInterval);
  if (info.timeoutId) clearTimeout(info.timeoutId);

  let usage = { cost: null, tokens: null };
  if (info.outputFile) {
    try {
      const raw = fs.readFileSync(info.outputFile, 'utf8');
      const text = stripAnsi(raw).trim();
      if (text) {
        usage = parseUsage(text);
        const MAX = 3000;
        const snippet = text.length > MAX ? '[…output truncated, showing last 3000 chars]\n' + text.slice(-MAX) : text;
        addCardNote(cardId, `Agent session output (exit ${code}):\n\`\`\`\n${snippet}\n\`\`\``);
      }
    } catch (_) {}
    try { fs.unlinkSync(info.outputFile); } catch (_) {}
  }

  const duration = Math.round((Date.now() - new Date(info.startTime).getTime()) / 1000);

  // Sanity check: if the workspace uses a worktree, verify the workspace root
  // is clean. Agent writes leaking outside the worktree should be visible here.
  if (info.worktreePath) {
    try {
      const status = execSync('git status --porcelain', {
        cwd: info.workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }).toString().trim();
      if (status) {
        const msg = `Worktree leak detected: workspace root (${info.workspacePath}) has dirty files after agent completed:\n${status.slice(0, 2000)}`;
        process.stderr.write(`[agent_warning] ${msg}\n`);
        addAgentLog(info.workspaceId, info.agentType, 'agent_warning', msg);
        addCardNote(cardId, `[WARN] ${msg}`);
      }
    } catch (_) {
      // git not available or not a repo; skip check silently
    }
  }

  // Persist the run outcome on the card so it survives refresh (shown as a badge).
  updateCard(cardId, {
    last_exit_code: code,
    last_duration: duration,
    last_cost: usage.cost,
    last_tokens: usage.tokens,
  });

  const status = code === 0 ? 'completed' : 'failed';
  addAgentLog(info.workspaceId, info.agentType, `agent_${status}`,
    `${info.agentType} ${status} for card ${cardId} (${duration}s, exit ${code})`);
  emitSSE('agent_completed', { cardId, agentType: info.agentType, code, duration, cost: usage.cost, tokens: usage.tokens });

  // Free capacity may now let a queued agent start.
  dequeueNext(emitSSE);

  // If this card was marked for respawn (e.g. agent moved itself to Review),
  // start the next phase now.
  if (pendingRespawn.has(cardId)) {
    const pending = pendingRespawn.get(cardId);
    pendingRespawn.delete(cardId);
    spawnAgent(cardId, pending.workspaceId, pending.agentType, emitSSE);
  }
}

function stopAgent(cardId) {
  // Drop it from the queue first, in case it was waiting rather than running.
  if (isQueued(cardId)) dequeueCard(cardId);

  // Clear any pending respawn — the user explicitly stopped this card.
  pendingRespawn.delete(cardId);

  const info = activeAgents.get(cardId);
  if (!info) return false;
  if (info.watchInterval) clearInterval(info.watchInterval);
  if (info.timeoutId) clearTimeout(info.timeoutId);
  try { info.child?.kill(); } catch (_) {}
  activeAgents.delete(cardId);
  removePid(cardId);
  addAgentLog(info.workspaceId, info.agentType, 'agent_stopped', `Stopped agent for card ${cardId}`);
  return true;
}

// Best-effort kill of every running agent's child process, used on server
// shutdown so agents don't outlive the server. Synchronous (no SSE/requeue) —
// the process is exiting. Note: with shell:true this kills the shell; a deeply
// nested grandchild may survive on some platforms, but the common case is covered.
function killAllAgents() {
  for (const info of activeAgents.values()) {
    if (info.watchInterval) clearInterval(info.watchInterval);
    if (info.timeoutId) clearTimeout(info.timeoutId);
    try { info.child?.kill(); } catch (_) {}
  }
  activeAgents.clear();
  agentQueue.length = 0;
  pendingRespawn.clear();
  // Also kill agents spawned by other process instances (e.g. MCP subprocesses)
  // that aren't in this process's activeAgents map.
  killAllRegisteredPids();
}

function isAgentRunning(cardId) {
  return activeAgents.has(cardId);
}

function isAgentActive(cardId) {
  return activeAgents.has(cardId) || isQueued(cardId);
}

function getRunningCardIds() {
  return Array.from(activeAgents.keys());
}

function isPendingRespawn(cardId) {
  return pendingRespawn.has(cardId);
}

function getPendingRespawnCardIds() {
  return Array.from(pendingRespawn.keys());
}

module.exports = { spawnAgent, agentDone, stopAgent, killAllAgents, isAgentRunning, isAgentActive, getRunningCardIds, getQueuedCardIds, getPendingRespawnCardIds, isPendingRespawn, getOutputFile, buildShellCmd, isSafeModel, parseUsage, buildPrompt, isQueued };
