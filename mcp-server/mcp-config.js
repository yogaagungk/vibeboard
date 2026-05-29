const fs = require('fs');
const os = require('os');
const path = require('path');

// Discover and write per-agent MCP configs so each CLI knows how to launch this
// server. serverPath points at index.js in this directory (the bin entry).
function getAgentMcpConfigs() {
  const home = os.homedir();
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const serverPath = path.join(__dirname, 'index.js');

  return {
    'claude-code': {
      label: 'Claude Code',
      cmd: 'claude',
      configPath: path.join(home, '.claude.json'),
      read: cfg => !!(cfg.mcpServers?.vibeboard),
      write: (_cfg, _configPath) => {
        // Use the CLI so Claude Code manages its own registry correctly
        const { execSync } = require('child_process');
        execSync(`claude mcp add -s user vibeboard -- node "${serverPath}"`, {
          stdio: 'pipe', timeout: 10000,
        });
        // Return null to signal the caller to skip the JSON write
        return null;
      },
    },
    'opencode': {
      label: 'OpenCode',
      cmd: 'opencode',
      // OpenCode uses XDG-style ~/.config/opencode/opencode.json on all platforms
      configPath: path.join(xdgConfig, 'opencode', 'opencode.json'),
      read: cfg => !!(cfg.mcp?.vibeboard),
      write: cfg => ({
        ...cfg,
        mcp: {
          ...(cfg.mcp || {}),
          vibeboard: { type: 'local', command: ['node', serverPath] },
        },
      }),
    },
    'codex': {
      label: 'Codex CLI',
      cmd: 'codex',
      configPath: path.join(home, '.codex', 'config.json'),
      read: cfg => !!(cfg.mcpServers?.vibeboard || cfg.mcp?.vibeboard),
      write: cfg => ({
        ...cfg,
        mcpServers: { ...(cfg.mcpServers || {}), vibeboard: { command: 'node', args: [serverPath] } },
      }),
    },
  };
}

function isAgentInstalled(cmd) {
  const { execSync } = require('child_process');
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

function readAgentMcpStatus(_key, info) {
  const installed = isAgentInstalled(info.cmd);
  if (!installed) return { installed: false, configured: false, configPath: info.configPath };
  try {
    const cfg = JSON.parse(fs.readFileSync(info.configPath, 'utf8'));
    return { installed: true, configured: info.read(cfg), configPath: info.configPath };
  } catch (_) {
    return { installed: true, configured: false, configPath: info.configPath };
  }
}

module.exports = { getAgentMcpConfigs, isAgentInstalled, readAgentMcpStatus };
