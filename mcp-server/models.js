const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let cachedModels = {
  'claude-code': [],
  'opencode': [],
  'codex': [],
  'command-code': [],
};

function getCacheFilePath() {
  const { DATA_DIR } = require('./db');
  return path.join(DATA_DIR, 'models-cache.json');
}

function loadCacheFromDisk() {
  try {
    const cacheFile = getCacheFilePath();
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (data && typeof data === 'object') {
        cachedModels = { ...cachedModels, ...data };
        process.stderr.write(`Models cache loaded from disk: Claude (${cachedModels['claude-code'].length}), OpenCode (${cachedModels['opencode'].length}), Codex (${cachedModels['codex'].length}), CommandCode (${cachedModels['command-code']?.length || 0})\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`Failed to load models cache from disk: ${err.message}\n`);
  }
}

function saveCacheToDisk() {
  try {
    const cacheFile = getCacheFilePath();
    fs.writeFileSync(cacheFile, JSON.stringify(cachedModels, null, 2), 'utf8');
  } catch (err) {
    process.stderr.write(`Failed to save models cache to disk: ${err.message}\n`);
  }
}

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
    { id: 'gpt-5.4',       name: 'GPT-5.4',       description: 'Everyday coding' },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex',  description: 'Coding-optimized' },
    { id: 'gpt-5.5',       name: 'GPT-5.5',        description: 'Frontier, complex tasks' },
    { id: 'gpt-5.2',       name: 'GPT-5.2',        description: 'Long-running agents' },
    { id: 'gpt-5.4-mini',  name: 'GPT-5.4 Mini',   description: 'Fast, cost-efficient' },
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

function getCommandCodeModels() {
  if (!isAgentInstalled('command-code')) return [];
  try {
    const output = execSync('command-code --list-models', { encoding: 'utf8', timeout: 15000 });
    const models = [];
    let currentSection = '';
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('Available models')) continue;
      // Stop at the footer hint block (not a model section)
      if (trimmed.startsWith('Pass the full id')) break;
      // Model lines are formatted as two columns separated by 2+ spaces.
      // Section headers (e.g. "Anthropic", "Open Source") have no such gap.
      const match = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._/-]*)\s{2,}(.+)$/);
      if (!match) { currentSection = trimmed; continue; }
      const id = match[1];
      // Derive a readable provider from the model ID prefix, fall back to section name
      const idProvider = id.includes('/') ? id.split('/')[0] : '';
      const description = idProvider || currentSection;
      const namePart = id.includes('/') ? id.split('/').slice(1).join('/') : id;
      const name = namePart.split(/[-_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        .replace(/\s*\(.*\)/, '').trim();
      models.push({ id, name, description });
    }
    return models;
  } catch (err) {
    process.stderr.write(`Failed to fetch CommandCode models: ${err.message}\n`);
    return [];
  }
}

function refreshAvailableModels() {
  cachedModels['claude-code'] = getClaudeModels();
  cachedModels['opencode'] = getOpenCodeModels();
  cachedModels['codex'] = getCodexModels();
  cachedModels['command-code'] = getCommandCodeModels();

  process.stderr.write(`Models refreshed: Claude (${cachedModels['claude-code'].length}), OpenCode (${cachedModels['opencode'].length}), Codex (${cachedModels['codex'].length}), CommandCode (${cachedModels['command-code'].length})\n`);

  saveCacheToDisk();

  return cachedModels;
}

function refreshAvailableModelsAsync() {
  setImmediate(() => {
    try {
      refreshAvailableModels();
    } catch (err) {
      process.stderr.write(`Background model refresh failed: ${err.message}\n`);
    }
  });
}

function getAvailableModels() {
  return cachedModels;
}

loadCacheFromDisk();

if (cachedModels['claude-code'].length === 0 && cachedModels['opencode'].length === 0 && cachedModels['codex'].length === 0 && cachedModels['command-code'].length === 0) {
  refreshAvailableModels();
} else {
  refreshAvailableModelsAsync();
}

module.exports = {
  refreshAvailableModels,
  getAvailableModels,
};
