const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getCard, getColumn, getWorkspace, addCardNote, addAgentLog } = require('./db');

const activeAgents = new Map();

const AGENT_CMDS = { 'claude-code': 'claude', 'opencode': 'opencode', 'codex': 'codex' };
const PORT = 7341;

function buildPrompt(card, column, workspace) {
  const desc = card.description ? `\nDescription: ${card.description}` : '';
  const tags = card.tags?.length ? `\nTags: ${card.tags.join(', ')}` : '';
  return `You have a task on VibeBoard.

Card: "${card.title}"${desc}${tags}
Column: ${column?.title || ''}
Card ID: ${card.id}

Use the vibeboard MCP tools to work on this task:
1. Call get_board to see the full board state
2. Use add_card_note to log progress and checkpoints
3. Call move_card to update status as you work
4. Call complete_card when done

Work in the project directory: ${workspace.path}`;
}

function writePromptFile(cardId, prompt) {
  const file = path.join(os.tmpdir(), `vb-${cardId}.txt`);
  fs.writeFileSync(file, prompt, 'utf8');
  return file;
}

function launchWindows(agentCmd, promptFile, workspaceDir, cardId, title) {
  const scriptFile = path.join(os.tmpdir(), `vb-${cardId}.ps1`);
  const script = [
    `$ErrorActionPreference = 'Continue'`,
    `Set-Location "${workspaceDir}"`,
    `Write-Host "━━━ VibeBoard Agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan`,
    `Write-Host "  Card: ${title.replace(/"/g, '`"')}" -ForegroundColor White`,
    `Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan`,
    `Write-Host ""`,
    `$prompt = Get-Content -Raw "${promptFile}"`,
    `& ${agentCmd} --prompt $prompt`,
    `$code = $LASTEXITCODE`,
    `Remove-Item "${promptFile}" -ErrorAction SilentlyContinue`,
    `try { Invoke-WebRequest -Uri "http://localhost:${PORT}/api/agent-done/${cardId}" -Method POST -Body (ConvertTo-Json @{code=$code}) -ContentType "application/json" -UseBasicParsing | Out-Null } catch {}`,
    `Write-Host ""`,
    `Write-Host "Agent finished (exit code $code). Press any key to close..." -ForegroundColor DarkGray`,
    `$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")`,
    `Remove-Item "${scriptFile}" -ErrorAction SilentlyContinue`,
  ].join('\n');
  fs.writeFileSync(scriptFile, script, 'utf8');

  const child = spawn('cmd', ['/c', `start "VibeBoard — ${title}" powershell -ExecutionPolicy Bypass -File "${scriptFile}"`], {
    detached: true, stdio: 'ignore',
  });
  child.unref();
}

function launchMac(agentCmd, promptFile, workspaceDir, cardId, title) {
  const scriptFile = path.join(os.tmpdir(), `vb-${cardId}.sh`);
  const script = [
    `#!/bin/bash`,
    `cd "${workspaceDir}"`,
    `echo "━━━ VibeBoard Agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"`,
    `echo "  Card: ${title.replace(/"/g, '\\"')}"`,
    `echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"`,
    `echo ""`,
    `PROMPT=$(cat "${promptFile}")`,
    `${agentCmd} --prompt "$PROMPT"`,
    `CODE=$?`,
    `rm -f "${promptFile}"`,
    `curl -s -X POST http://localhost:${PORT}/api/agent-done/${cardId} -H "Content-Type: application/json" -d "{\\"code\\":$CODE}" > /dev/null 2>&1 || true`,
    `echo ""`,
    `echo "Agent finished (exit $CODE). Press Enter to close..."`,
    `read`,
    `rm -f "${scriptFile}"`,
  ].join('\n');
  fs.writeFileSync(scriptFile, script, { encoding: 'utf8', mode: 0o755 });

  const child = spawn('osascript', ['-e', `tell application "Terminal" to do script "bash '${scriptFile}'"`], {
    detached: true, stdio: 'ignore',
  });
  child.unref();
}

function launchLinux(agentCmd, promptFile, workspaceDir, cardId, title) {
  const scriptFile = path.join(os.tmpdir(), `vb-${cardId}.sh`);
  const script = [
    `#!/bin/bash`,
    `cd "${workspaceDir}"`,
    `echo "━━━ VibeBoard Agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"`,
    `echo "  Card: ${title.replace(/"/g, '\\"')}"`,
    `echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"`,
    `echo ""`,
    `PROMPT=$(cat "${promptFile}")`,
    `${agentCmd} --prompt "$PROMPT"`,
    `CODE=$?`,
    `rm -f "${promptFile}"`,
    `curl -s -X POST http://localhost:${PORT}/api/agent-done/${cardId} -H "Content-Type: application/json" -d "{\\"code\\":$CODE}" > /dev/null 2>&1 || true`,
    `echo ""`,
    `echo "Agent finished (exit $CODE). Press Enter to close..."`,
    `read`,
    `rm -f "${scriptFile}"`,
  ].join('\n');
  fs.writeFileSync(scriptFile, script, { encoding: 'utf8', mode: 0o755 });

  const terminals = [
    ['gnome-terminal', ['--', 'bash', scriptFile]],
    ['konsole', ['-e', 'bash', scriptFile]],
    ['xfce4-terminal', ['-e', `bash "${scriptFile}"`]],
    ['lxterminal', ['-e', `bash "${scriptFile}"`]],
    ['xterm', ['-e', `bash "${scriptFile}"`]],
  ];

  let launched = false;
  for (const [term, args] of terminals) {
    try {
      const child = spawn(term, args, { detached: true, stdio: 'ignore' });
      child.unref();
      launched = true;
      break;
    } catch (_) {}
  }
  if (!launched) throw new Error('No terminal emulator found. Install gnome-terminal, konsole, or xterm.');
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

  const agentCmd = AGENT_CMDS[agentType] || agentType;
  const prompt = buildPrompt(card, column, workspace);
  const promptFile = writePromptFile(cardId, prompt);

  try {
    if (process.platform === 'win32') launchWindows(agentCmd, promptFile, workspace.path, cardId, card.title);
    else if (process.platform === 'darwin') launchMac(agentCmd, promptFile, workspace.path, cardId, card.title);
    else launchLinux(agentCmd, promptFile, workspace.path, cardId, card.title);

    activeAgents.set(cardId, { cardId, workspaceId, agentType, startTime: new Date().toISOString() });
    addAgentLog(workspaceId, agentType, 'agent_started', `Spawned ${agentType} terminal for: ${card.title}`);
    emitSSE('agent_started', { cardId, agentType, title: card.title });
    process.stderr.write(`Spawned ${agentCmd} terminal for card ${cardId}\n`);
  } catch (err) {
    fs.unlink(promptFile, () => {});
    process.stderr.write(`Failed to spawn terminal: ${err.message}\n`);
    addAgentLog(workspaceId, agentType, 'agent_error', `Failed to spawn terminal: ${err.message}`);
    addCardNote(cardId, `Agent failed to start: ${err.message}`);
    emitSSE('agent_error', { cardId, agentType, error: err.message });
  }
}

function agentDone(cardId, code, emitSSE) {
  const info = activeAgents.get(cardId);
  if (!info) return;
  activeAgents.delete(cardId);

  const duration = Math.round((Date.now() - new Date(info.startTime).getTime()) / 1000);
  const status = code === 0 ? 'completed' : 'failed';
  addAgentLog(info.workspaceId, info.agentType, `agent_${status}`,
    `${info.agentType} ${status} for card ${cardId} (${duration}s, exit ${code})`);
  emitSSE('agent_completed', { cardId, agentType: info.agentType, code, duration });
}

function stopAgent(cardId) {
  const info = activeAgents.get(cardId);
  if (!info) return false;
  activeAgents.delete(cardId);
  addAgentLog(info.workspaceId, info.agentType, 'agent_stopped', `Removed tracking for card ${cardId} (terminal runs independently)`);
  return true;
}

function isAgentRunning(cardId) {
  return activeAgents.has(cardId);
}

module.exports = { spawnAgent, agentDone, stopAgent, isAgentRunning };
