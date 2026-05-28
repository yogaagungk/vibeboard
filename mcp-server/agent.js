const { spawn } = require('child_process');
const path = require('path');
const { getCard, getColumn, getWorkspace, addCardNote, moveCard, addAgentLog } = require('./db');

const activeAgents = new Map();

function spawnAgent(cardId, workspaceId, agentType, emitSSE) {
  if (activeAgents.has(cardId)) {
    process.stderr.write(`Agent already running for card ${cardId}\n`);
    return;
  }

  const card = getCard(cardId);
  if (!card) {
    process.stderr.write(`Card ${cardId} not found\n`);
    return;
  }

  const column = getColumn(card.column_id);
  const workspace = getWorkspace(workspaceId);
  
  if (!workspace || !workspace.path) {
    process.stderr.write(`Workspace ${workspaceId} has no path\n`);
    return;
  }

  const agentCmd = agentType === 'claude-code' ? 'claude' : agentType === 'codex' ? 'codex' : 'opencode';
  const prompt = `You have a task on VibeBoard.

Card: "${card.title}"
${card.description ? `Description: ${card.description}` : ''}
${card.tags && card.tags.length ? `Tags: ${card.tags.join(', ')}` : ''}
Column: ${column?.title || ''}
Card ID: ${cardId}

Use the vibeboard MCP tools to work on this task:
1. Call get_board to see the full board state
2. Use add_card_note to log progress and checkpoints
3. Call move_card to update status as you work
4. Call complete_card when done

Work in the project directory: ${workspace.path}`;

  process.stderr.write(`Spawning ${agentCmd} for card ${cardId} in ${workspace.path}\n`);

  const agentProcess = spawn(agentCmd, ['--prompt', prompt], {
    cwd: workspace.path,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  const agentInfo = {
    process: agentProcess,
    cardId,
    workspaceId,
    agentType,
    startTime: new Date().toISOString(),
  };

  activeAgents.set(cardId, agentInfo);

  addAgentLog(workspaceId, agentType, 'agent_started', `Started ${agentType} for card: ${card.title}`);
  emitSSE('agent_started', { cardId, agentType, title: card.title });

  let stdout = '';
  let stderr = '';

  agentProcess.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  agentProcess.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  agentProcess.on('close', (code) => {
    activeAgents.delete(cardId);
    
    const duration = Math.round((Date.now() - new Date(agentInfo.startTime).getTime()) / 1000);
    const status = code === 0 ? 'completed' : 'failed';
    
    addAgentLog(
      workspaceId,
      agentType,
      `agent_${status}`,
      `${agentType} ${status} for card: ${card.title} (${duration}s, exit code: ${code})`
    );

    if (stdout.trim()) {
      addCardNote(cardId, `Agent output:\n${stdout.trim()}`);
    }
    if (stderr.trim() && code !== 0) {
      addCardNote(cardId, `Agent errors:\n${stderr.trim()}`);
    }

    emitSSE('agent_completed', { cardId, agentType, code, duration });

    process.stderr.write(`Agent ${agentType} for card ${cardId} exited with code ${code}\n`);
  });

  agentProcess.on('error', (err) => {
    activeAgents.delete(cardId);
    process.stderr.write(`Failed to spawn ${agentCmd}: ${err.message}\n`);
    addAgentLog(workspaceId, agentType, 'agent_error', `Failed to start ${agentType}: ${err.message}`);
    addCardNote(cardId, `Agent failed to start: ${err.message}`);
    emitSSE('agent_error', { cardId, agentType, error: err.message });
  });
}

function stopAgent(cardId) {
  const agentInfo = activeAgents.get(cardId);
  if (!agentInfo) return false;

  try {
    agentInfo.process.kill('SIGTERM');
    activeAgents.delete(cardId);
    addAgentLog(agentInfo.workspaceId, agentInfo.agentType, 'agent_stopped', `Stopped agent for card ${cardId}`);
    return true;
  } catch (err) {
    process.stderr.write(`Failed to stop agent for card ${cardId}: ${err.message}\n`);
    return false;
  }
}

function isAgentRunning(cardId) {
  return activeAgents.has(cardId);
}

module.exports = {
  spawnAgent,
  stopAgent,
  isAgentRunning,
};
