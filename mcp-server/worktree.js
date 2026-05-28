const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function isGitRepo(dir) {
  try { execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

function getBaseBranch(dir) {
  try {
    const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: dir, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return ref.replace('refs/remotes/origin/', '');
  } catch (_) {}
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: dir, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch (_) { return 'main'; }
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function ensureGitignored(workspacePath) {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  try {
    const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    if (!existing.includes('.vb-worktrees')) {
      fs.appendFileSync(gitignorePath, (existing.endsWith('\n') ? '' : '\n') + '.vb-worktrees/\n');
    }
  } catch (_) {}
}

function hasCommits(dir) {
  try { execSync('git rev-parse HEAD', { cwd: dir, stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

function createWorktree(workspacePath, cardId, cardTitle) {
  if (!isGitRepo(workspacePath)) return null;

  // Can't create a worktree on a repo with no commits — agent will run in workspace dir
  if (!hasCommits(workspacePath)) {
    process.stderr.write(`No commits in ${workspacePath} — skipping worktree, agent runs in workspace dir\n`);
    return null;
  }

  const slug = slugify(cardTitle || 'task');
  const shortId = cardId.replace(/[^a-z0-9]/gi, '').slice(-8);
  const branch = `vb/${slug}-${shortId}`;
  const worktreePath = path.join(workspacePath, '.vb-worktrees', `${slug}-${shortId}`);

  ensureGitignored(workspacePath);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  execSync(`git worktree add -b "${branch}" "${worktreePath}"`, { cwd: workspacePath });
  process.stderr.write(`Worktree created: ${worktreePath} (${branch})\n`);

  return { branch, worktreePath };
}

function removeWorktree(workspacePath, worktreePath) {
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd: workspacePath, stdio: 'ignore' });
  } catch (_) {
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch (_) {}
  }
  try { execSync('git worktree prune', { cwd: workspacePath, stdio: 'ignore' }); } catch (_) {}
}

function getDiff(worktreePath, baseBranch) {
  try {
    return execSync(`git diff "${baseBranch}...HEAD"`, {
      cwd: worktreePath, maxBuffer: 5 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch (_) { return ''; }
}

function getCommits(worktreePath, baseBranch) {
  try {
    return execSync(`git log "${baseBranch}..HEAD" --oneline`, {
      cwd: worktreePath, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch (_) { return ''; }
}

function mergeBranch(workspacePath, branch, worktreePath) {
  execSync(`git merge --no-ff "${branch}" -m "Merge ${branch}"`, { cwd: workspacePath });
  try { execSync(`git branch -d "${branch}"`, { cwd: workspacePath, stdio: 'ignore' }); } catch (_) {}
  if (worktreePath) removeWorktree(workspacePath, worktreePath);
}

function pushAndCreatePR(worktreePath, title) {
  execSync('git push -u origin HEAD', { cwd: worktreePath });
  return execSync(`gh pr create --title "${title.replace(/"/g, '\\"')}" --fill`, {
    cwd: worktreePath, stdio: ['ignore', 'pipe', 'ignore'],
  }).toString().trim();
}

module.exports = {
  isGitRepo, getBaseBranch,
  createWorktree, removeWorktree,
  getDiff, getCommits,
  mergeBranch, pushAndCreatePR,
};
