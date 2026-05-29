'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Paths the agent is never allowed to be spawned in. The agent runs with
// --dangerously-skip-permissions so a workspace pointing at the filesystem
// root, the home directory itself, or a system dir would let it touch
// anything the user can. Subdirectories of any of these are still allowed
// (e.g. ~/projects/foo, C:\Users\me\Desktop\repo), only the dirs themselves
// are denied. This is a guardrail against typos and mistakes - it is not a
// security boundary against an already-compromised local machine.

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

// String-compare two normalized absolute paths for equality, honoring the
// platform's filesystem case sensitivity. NTFS and APFS default to
// case-insensitive; ext4/btrfs are case-sensitive.
function pathEqual(a, b) {
  if (!a || !b) return false;
  return (WIN || MAC) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Build the deny-list at module load. os.homedir() and the system roots are
// resolved once - they don't change at runtime.
function buildDenyList() {
  const list = new Set();
  const add = (p) => { if (p) list.add(path.resolve(p)); };

  add(os.homedir());

  if (WIN) {
    const sysDrive = process.env.SystemDrive || 'C:';
    add(sysDrive + '\\');
    add(process.env.SystemRoot || 'C:\\Windows');
    add(process.env.ProgramFiles || 'C:\\Program Files');
    add(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
    add(process.env.ProgramData || 'C:\\ProgramData');
    // All drive roots that exist (D:\, E:\, ...). spawn() in a drive root
    // would let the agent walk the whole drive.
    for (let c = 65; c <= 90; c++) {
      const root = String.fromCharCode(c) + ':\\';
      try { if (fs.existsSync(root)) add(root); } catch (_) {}
    }
  } else {
    add('/');
    add('/etc');
    add('/usr');
    add('/bin');
    add('/sbin');
    add('/var');
    add('/opt');
    if (MAC) {
      add('/System');
      add('/Library');
      add('/Applications');
    }
  }

  return [...list];
}

const DENY_LIST = buildDenyList();

// Validate a workspace path. Throws on obvious foot-guns (non-existent,
// not a directory, drive/home/system root). Returns the resolved real path.
function validateWorkspacePath(p) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error('Workspace path is required');
  }
  const resolved = path.resolve(p);

  for (const denied of DENY_LIST) {
    if (pathEqual(resolved, denied)) {
      throw new Error(`Workspace path is a protected location: ${denied}`);
    }
  }

  let stat;
  try { stat = fs.lstatSync(resolved); }
  catch (err) {
    if (err.code === 'ENOENT') throw new Error(`Workspace path does not exist: ${resolved}`);
    throw err;
  }
  if (!stat.isDirectory()) throw new Error(`Workspace path is not a directory: ${resolved}`);

  return resolved;
}

// Verify a directory right before spawning an agent in it. Stricter than
// validateWorkspacePath: refuses symlinks (so a symlink swap can't redirect
// an in-flight spawn) and, when expectedRoot is supplied, requires the
// resolved path to be at or under the expected root (catches a worktree
// that escaped its workspace).
function verifySpawnDir(dir, expectedRoot) {
  if (!dir) throw new Error('Spawn directory is empty');
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to spawn in a symlink: ${dir}`);
  if (!stat.isDirectory()) throw new Error(`Spawn target is not a directory: ${dir}`);

  const resolved = fs.realpathSync(dir);

  if (expectedRoot) {
    const root = fs.realpathSync(expectedRoot);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    const inside = pathEqual(resolved, root) ||
      (WIN || MAC
        ? resolved.toLowerCase().startsWith(rootWithSep.toLowerCase())
        : resolved.startsWith(rootWithSep));
    if (!inside) {
      throw new Error(`Spawn dir escapes workspace root: ${resolved} not under ${root}`);
    }
  }

  for (const denied of DENY_LIST) {
    if (pathEqual(resolved, denied)) {
      throw new Error(`Spawn dir resolved to a protected location: ${denied}`);
    }
  }

  return resolved;
}

module.exports = { validateWorkspacePath, verifySpawnDir, DENY_LIST };
