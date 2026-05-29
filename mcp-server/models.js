const { execSync } = require('child_process');

let cachedModels = {
  'claude-code': [],
  'opencode': [],
  'codex': [],
};

function isAgentInstalled(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

function getClaudeModels() {
  if (!isAgentInstalled('claude')) return [];
  return [
    { id: 'claude-opus-4-8',   name: 'Claude Opus 4.8',   description: 'Most capable' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Balanced performance' },
    { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  description: 'Fastest, most affordable' },
  ];
}

// Codex (OpenAI) has no stable machine-readable model list command, so ship a
// curated set of the model aliases the CLI accepts. "Default" (no flag) stays
// the first option in the UI, so these are opt-in.
function getCodexModels() {
  if (!isAgentInstalled('codex')) return [];
  return [
    { id: 'gpt-5-codex', name: 'GPT-5 Codex', description: 'Codex-tuned' },
    { id: 'gpt-5',       name: 'GPT-5',       description: 'General purpose' },
    { id: 'o4-mini',     name: 'o4-mini',     description: 'Fast, affordable' },
  ];
}

function getOpenCodeModels() {
  if (!isAgentInstalled('opencode')) return [];
  
  try {
    const output = execSync('opencode models', { encoding: 'utf8', timeout: 15000 });
    
    const models = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines
      if (!trimmed) continue;
      
      // Each line is in format: provider/model-name
      if (trimmed.includes('/')) {
        const [provider, modelName] = trimmed.split('/');
        const modelId = trimmed;
        let name = modelName;
        let description = provider;
        
        // Special handling for opencode free models
        if (provider === 'opencode' && modelName.includes('free')) {
          name = modelName.replace(/-free$/, '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          description = 'Free tier';
        } else {
          // Capitalize model name nicely
          name = modelName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
        
        models.push({ id: modelId, name, description });
      }
    }
    
    // Prioritize opencode free models at the top
    const freeModels = models.filter(m => m.id.startsWith('opencode/'));
    const otherModels = models.filter(m => !m.id.startsWith('opencode/'));
    
    return [...freeModels, ...otherModels];
  } catch (err) {
    process.stderr.write(`Failed to fetch OpenCode models: ${err.message}\n`);
    return [];
  }
}

function refreshAvailableModels() {
  cachedModels['claude-code'] = getClaudeModels();
  cachedModels['opencode'] = getOpenCodeModels();
  cachedModels['codex'] = getCodexModels();

  process.stderr.write(`Models refreshed: Claude (${cachedModels['claude-code'].length}), OpenCode (${cachedModels['opencode'].length}), Codex (${cachedModels['codex'].length})\n`);

  return cachedModels;
}

function getAvailableModels() {
  return cachedModels;
}

refreshAvailableModels();

module.exports = {
  refreshAvailableModels,
  getAvailableModels,
};
