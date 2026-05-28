const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getCard, getColumn, getWorkspace, updateCard, addCardNote, addAgentLog } = require('./db');
const wt = require('./worktree');

const activeAgents = new Map();

const PORT = process.env.PORT || 7341;

// Build a shell command string for each agent that reads the prompt from a temp file.
// Using a shell command string (not arg array) avoids quoting issues with multiline prompts.
function buildShellCmd(agentType, promptFile) {
  const win = process.platform === 'win32';
  switch (agentType) {
    case 'claude-code':
      return win
        ? `type "${promptFile}" | claude --print --dangerously-skip-permissions`
        : `claude --print --dangerously-skip-permissions < "${promptFile}"`;
    case 'opencode':
      // opencode run takes the message as a positional argument, not --prompt
      return win
        ? `powershell -NoProfile -NonInteractive -Command "opencode run (Get-Content -Raw '${promptFile.replace(/'/g, "''")}')"`
        : `opencode run "$(cat '${promptFile.replace(/'/g, "'\\''")}')"`;
    case 'codex':
      return win
        ? `type "${promptFile}" | codex --full-auto`
        : `codex --full-auto < "${promptFile}"`;
    default:
      return win
        ? `type "${promptFile}" | ${agentType}`
        : `${agentType} < "${promptFile}"`;
  }
}

function getOutputFile(cardId) {
  return path.join(os.tmpdir(), `vb-output-${cardId}.txt`);
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

function buildPrompt(card, column, workspace, branch) {
  const desc = card.description ? `\nDescription: ${card.description}` : '';
  const tags = card.tags?.length ? `\nTags: ${card.tags.join(', ')}` : '';
  const branchLine = branch ? `\nGit branch: ${branch} (commit your changes here as you work)` : '';
  return `You have a task on VibeBoard.

Card: "${card.title}"${desc}${tags}
Column: ${column?.title || ''}
Card ID: ${card.id}
Workspace ID: ${workspace.id}${branchLine}

Columns:
- In Progress → plan and implement the feature/fix
- Review → code review and/or testing
- Done → complete but NOT auto-merged — the user will merge manually or create a PR

Use the vibeboard MCP tools to work on this task:
1. Call get_board to see the full board state
2. Use add_card_note frequently to log your progress, decisions, and any issues found
3. Commit your changes with git as you work
4. Call move_card to move the card to Review when ready for review/testing
5. Call complete_card to mark as Done when fully finished

In the project directory, run git commands, edit files, and test as needed.
Work in: ${workspace.path}`;
}

function launchAgent(agentType, prompt, outputFile, workspaceDir, cardId) {
  const promptFile = path.join(os.tmpdir(), `vb-prompt-${cardId}.txt`);
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const cmd = buildShellCmd(agentType, promptFile);
  const outStream = fs.createWriteStream(outputFile, { flags: 'w' });

  const child = spawn(cmd, [], {
    cwd: workspaceDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: true,
  });

  child.stdout.pipe(outStream, { end: false });
  child.stderr.pipe(outStream, { end: false });

  child.on('close', (code) => {
    outStream.end();
    try { fs.unlinkSync(promptFile); } catch (_) {}
    fetch(`http://localhost:${PORT}/api/agent-done/${cardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code ?? 1 }),
    }).catch(() => {});
  });

  child.on('error', (err) => {
    outStream.write(`\n[error: ${err.message}]\n`);
    outStream.end();
    try { fs.unlinkSync(promptFile); } catch (_) {}
    fetch(`http://localhost:${PORT}/api/agent-done/${cardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 1 }),
    }).catch(() => {});
  });

  return child;
}

function spawnAgent(cardId, workspaceId, agentType, emitSSE) {
  if (activeAgents.has(cardId)) {
    process.stderr.write(`Agent already running for card ${cardId}\n`);
    return;
  }

  const card = getCard(cardId);
  if (!card) { process.stderr.write(`Card ${cardId} not found\n`); return; }

  const column = getColumn(card.column_id);
  const workspace = getWorkspace(workspaceId);
  if (!workspace?.path) { process.stderr.write(`Workspace ${workspaceId} has no path\n`); return; }

  let branch = null, worktreePath = null, spawnDir = workspace.path;
  try {
    const wtResult = wt.createWorktree(workspace.path, cardId, card.title);
    if (wtResult) {
      branch = wtResult.branch;
      worktreePath = wtResult.worktreePath;
      spawnDir = wtResult.worktreePath;
      updateCard(cardId, { branch, worktreePath });
      emitSSE('board_update', require('./db').getBoard(workspaceId));
    }
  } catch (err) {
    process.stderr.write(`Worktree creation failed (running in workspace dir): ${err.message}\n`);
  }

  const prompt = buildPrompt(card, column, workspace, branch);
  const outputFile = getOutputFile(cardId);
  try { fs.unlinkSync(outputFile); } catch (_) {}

  try {
    const child = launchAgent(agentType, prompt, outputFile, spawnDir, cardId);
    const watchInterval = startOutputWatcher(cardId, outputFile, emitSSE);

    activeAgents.set(cardId, {
      cardId, workspaceId, agentType, child,
      startTime: new Date().toISOString(),
      outputFile, watchInterval,
    });

    addAgentLog(workspaceId, agentType, 'agent_started', `Started ${agentType} for: ${card.title}`);
    emitSSE('agent_started', { cardId, agentType, title: card.title });
    process.stderr.write(`Started ${agentType} (background) for card ${cardId}\n`);
  } catch (err) {
    process.stderr.write(`Failed to start agent: ${err.message}\n`);
    addAgentLog(workspaceId, agentType, 'agent_error', `Failed to start: ${err.message}`);
    addCardNote(cardId, `Agent failed to start: ${err.message}`);
    emitSSE('agent_error', { cardId, agentType, error: err.message });
  }
}

function agentDone(cardId, code, emitSSE) {
  const info = activeAgents.get(cardId);
  if (!info) return;
  activeAgents.delete(cardId);

  if (info.watchInterval) clearInterval(info.watchInterval);

  if (info.outputFile) {
    try {
      const raw = fs.readFileSync(info.outputFile, 'utf8');
      const output = stripAnsi(raw).trim();
      if (output) {
        const lines = output.split('\n');
        const tail = lines.slice(-80).join('\n');
        addCardNote(cardId, `Agent output:\n${tail}`);
      }
    } catch (_) {}
    try { fs.unlinkSync(info.outputFile); } catch (_) {}
  }

  const duration = Math.round((Date.now() - new Date(info.startTime).getTime()) / 1000);
  const status = code === 0 ? 'completed' : 'failed';
  addAgentLog(info.workspaceId, info.agentType, `agent_${status}`,
    `${info.agentType} ${status} for card ${cardId} (${duration}s, exit ${code})`);
  emitSSE('agent_completed', { cardId, agentType: info.agentType, code, duration });
}

function stopAgent(cardId) {
  const info = activeAgents.get(cardId);
  if (!info) return false;
  if (info.watchInterval) clearInterval(info.watchInterval);
  try { info.child?.kill(); } catch (_) {}
  activeAgents.delete(cardId);
  addAgentLog(info.workspaceId, info.agentType, 'agent_stopped', `Stopped agent for card ${cardId}`);
  return true;
}

function isAgentRunning(cardId) {
  return activeAgents.has(cardId);
}

function getRunningCardIds() {
  return Array.from(activeAgents.keys());
}

module.exports = { spawnAgent, agentDone, stopAgent, isAgentRunning, getRunningCardIds, getOutputFile };
