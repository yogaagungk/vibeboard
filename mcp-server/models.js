const { execSync } = require('child_process');

let cachedModels = {
  'claude-code': [],
  'opencode': [],
};

function isAgentInstalled(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

function getClaudeModels() {
  if (!isAgentInstalled('claude')) return [];
  
  try {
    const models = [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Balanced performance' },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', description: 'Most capable' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest, most affordable' },
    ];
    
    return models;
  } catch (err) {
    process.stderr.write(`Failed to fetch Claude models: ${err.message}\n`);
    return [];
  }
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
  
  process.stderr.write(`Models refreshed: Claude (${cachedModels['claude-code'].length}), OpenCode (${cachedModels['opencode'].length})\n`);
  
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
