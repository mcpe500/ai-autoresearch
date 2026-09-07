// src/git.js - Git Repository Management for Autoresearch
import { execSync } from 'node:child_process';

function runGit(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return null;
  }
}

export class GitManager {
  getCurrentBranch() {
    return runGit('rev-parse --abbrev-ref HEAD') || 'master';
  }

  getCurrentCommitHash() {
    return runGit('rev-parse --short HEAD') || 'unknown';
  }

  ensureBranch(branchName = 'autoresearch/run') {
    const current = this.getCurrentBranch();
    if (current !== branchName) {
      const branches = runGit('branch --list') || '';
      if (branches.includes(branchName)) {
        runGit(`checkout ${branchName}`);
      } else {
        runGit(`checkout -b ${branchName}`);
      }
    }
  }

  getDiff(file = 'train.py') {
    return runGit(`diff ${file}`) || '';
  }

  commit(iteration, hypothesis) {
    runGit('add train.py results.tsv');
    const cleanHypothesis = hypothesis.replace(/["`$]/g, '').slice(0, 72);
    runGit(`commit -m "exp-${iteration}: ${cleanHypothesis}"`);
    return this.getCurrentCommitHash();
  }

  discard(file = 'train.py') {
    runGit(`checkout HEAD -- ${file}`);
  }

  getRecentLog(limit = 5) {
    const raw = runGit(`log -n ${limit} --oneline`);
    return raw ? raw.split('\n') : [];
  }
}

export const git = new GitManager();
