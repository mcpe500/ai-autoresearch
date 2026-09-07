// src/runner.js - Continuous 100+ Hour Research Loop Coordinator
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { git } from './git.js';
import { llm } from './llm.js';
import { parseExperimentOutput } from './parser.js';

class ResearchRunner {
  constructor() {
    this.status = 'IDLE'; // IDLE | THINKING | RUNNING_EXPERIMENT | EVALUATING | PAUSED | STOPPED
    this.currentIteration = 0;
    this.subscribers = new Set();
    this.lastError = null;
    this.activeChild = null;
    this.startTime = Date.now();
    this.isStepping = false;
    this.init();
  }

  init() {
    const savedIteration = db.getState('current_iteration', 0);
    this.currentIteration = savedIteration;
    this.bestScore = db.getState('best_pareto_score', 17.9602);
    this.bestBpw = db.getState('best_bpw', 0.5609);
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  broadcast(event, data) {
    const payload = { event, data, timestamp: new Date().toISOString() };
    for (const listener of this.subscribers) {
      try {
        listener(payload);
      } catch (err) {}
    }
  }

  setStatus(newStatus) {
    this.status = newStatus;
    this.broadcast('status_change', { status: this.status, iteration: this.currentIteration });
  }

  async start() {
    if (this.status === 'RUNNING_EXPERIMENT' || this.status === 'THINKING') return;
    this.setStatus('IDLE');
    git.ensureBranch();
    this.runLoop();
  }

  pause() {
    this.setStatus('PAUSED');
  }

  resume() {
    if (this.status === 'PAUSED' || this.status === 'IDLE') {
      this.setStatus('IDLE');
      this.runLoop();
    }
  }

  async runStep() {
    if (this.status === 'RUNNING_EXPERIMENT' || this.status === 'THINKING') return;
    this.isStepping = true;
    this.setStatus('IDLE');
    await this.executeSingleIteration();
    this.setStatus('PAUSED');
    this.isStepping = false;
  }

  async runLoop() {
    while (this.status !== 'PAUSED' && this.status !== 'STOPPED') {
      await this.executeSingleIteration();
      // Brief cool-down between iterations to keep VPS CPU healthy
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  async executeSingleIteration() {
    this.currentIteration++;
    db.setState('current_iteration', this.currentIteration);
    const iter = this.currentIteration;

    this.broadcast('log', `\n======================================================\n🚀 Kicking off Experiment #${iter}\n======================================================`);
    
    // 1. Gather context
    const programPrompt = readFileSync(resolve(process.cwd(), 'program.md'), 'utf-8');
    const currentCode = readFileSync(resolve(process.cwd(), 'train.py'), 'utf-8');
    const history = db.getAllExperiments().slice(0, 5);

    // 2. LLM proposes hypothesis and code mutation
    this.setStatus('THINKING');
    this.broadcast('log', `[LLM] Consulting AI Scientist for next hypothesis (Iteration ${iter})...`);
    
    let proposal;
    try {
      proposal = await llm.generateNextExperiment({
        programPrompt,
        currentCode,
        history,
        lastError: this.lastError
      });
    } catch (err) {
      this.broadcast('log', `[ERROR] LLM generation failed: ${err.message}`);
      this.lastError = err.message;
      this.setStatus('PAUSED');
      return;
    }

    this.broadcast('hypothesis', {
      iteration: iter,
      hypothesis: proposal.hypothesis,
      rationale: proposal.rationale
    });
    this.broadcast('log', `💡 Hypothesis: ${proposal.hypothesis}`);
    if (proposal.rationale) {
      this.broadcast('log', `📖 Rationale: ${proposal.rationale}`);
    }

    if (!proposal.code) {
      this.broadcast('log', `[ERROR] LLM did not return valid Python code block. Skipping iteration.`);
      return;
    }

    // 3. Apply code mutation & check syntax
    writeFileSync(resolve(process.cwd(), 'train.py'), proposal.code, 'utf-8');
    const codeDiff = git.getDiff('train.py');

    try {
      execSync('python3 -m py_compile train.py', { stdio: 'pipe' });
    } catch (syntaxErr) {
      this.broadcast('log', `[SYNTAX ERROR] Python syntax validation failed. Rolling back.`);
      git.discard('train.py');
      this.lastError = `SyntaxError: Code provided in iteration ${iter} failed python py_compile.`;
      db.insertExperiment({
        iteration: iter,
        hypothesis: proposal.hypothesis,
        rationale: proposal.rationale,
        code_diff: codeDiff,
        status: 'CRASH',
        stderr: this.lastError
      });
      return;
    }

    // 4. Run experiment in isolated subprocess with timeout and nice level
    this.setStatus('RUNNING_EXPERIMENT');
    const timeoutSec = config.get('EXPERIMENT_TIMEOUT_SEC');
    const niceLevel = config.get('PROCESS_NICE');
    const startTime = Date.now();

    const { code, stdout, stderr, timedOut } = await this.runExperimentProcess(niceLevel, timeoutSec);
    const durationSec = Number(((Date.now() - startTime) / 1000).toFixed(2));

    // 5. Evaluate result
    this.setStatus('EVALUATING');
    if (timedOut) {
      this.broadcast('log', `[TIMEOUT] Experiment exceeded ${timeoutSec}s limit. Discarding.`);
      git.discard('train.py');
      this.lastError = `TimeoutError: Script took > ${timeoutSec}s. Keep computations faster.`;
      db.insertExperiment({
        iteration: iter,
        hypothesis: proposal.hypothesis,
        rationale: proposal.rationale,
        code_diff: codeDiff,
        duration_sec: durationSec,
        status: 'CRASH',
        stderr: this.lastError
      });
      return;
    }

    if (code !== 0) {
      this.broadcast('log', `[CRASH] Experiment exited with code ${code}. Error:\n${stderr.slice(-300)}`);
      git.discard('train.py');
      this.lastError = `RuntimeError (Exit code ${code}):\n${stderr.slice(-500)}`;
      db.insertExperiment({
        iteration: iter,
        hypothesis: proposal.hypothesis,
        rationale: proposal.rationale,
        code_diff: codeDiff,
        duration_sec: durationSec,
        status: 'CRASH',
        stdout,
        stderr
      });
      return;
    }

    // Parse metrics
    const metrics = parseExperimentOutput(stdout);
    if (!metrics) {
      this.broadcast('log', `[ERROR] Could not parse standard metrics block from output.`);
      git.discard('train.py');
      this.lastError = `FormatError: Output did not contain valid delimiter block (--- bpw: ...).`;
      db.insertExperiment({
        iteration: iter,
        hypothesis: proposal.hypothesis,
        rationale: proposal.rationale,
        code_diff: codeDiff,
        duration_sec: durationSec,
        status: 'CRASH',
        stdout,
        stderr: this.lastError
      });
      return;
    }

    // 6. Decision: KEEP or DISCARD
    this.lastError = null; // Clear prior errors on clean run
    const prevBestScore = this.bestScore;
    const isImprovement = metrics.pareto_score < prevBestScore;

    let status = 'DISCARD';
    if (isImprovement) {
      status = 'KEEP';
      this.bestScore = metrics.pareto_score;
      this.bestBpw = metrics.bpw;
      db.setState('best_pareto_score', this.bestScore);
      db.setState('best_bpw', this.bestBpw);

      // Append to results.tsv
      const tsvLine = `${iter}\texp-${iter}\t${metrics.bpw}\t${metrics.degradation_pct}\t${metrics.pareto_score}\t${metrics.compression_ratio}x\t${durationSec}\tKEEP\t${proposal.hypothesis.replace(/\t/g, ' ')}\n`;
      appendFileSync(resolve(process.cwd(), 'results.tsv'), tsvLine, 'utf-8');

      // Commit to git
      const commitHash = git.commit(iter, proposal.hypothesis);
      this.broadcast('log', `✅ [IMPROVEMENT] Pareto Score: ${metrics.pareto_score.toFixed(4)} < ${prevBestScore.toFixed(4)} (BPW: ${metrics.bpw}, Deg: ${metrics.degradation_pct}%). COMMITTED (${commitHash})!`);
    } else {
      git.discard('train.py');
      // Append to results.tsv
      const tsvLine = `${iter}\tdiscarded\t${metrics.bpw}\t${metrics.degradation_pct}\t${metrics.pareto_score}\t${metrics.compression_ratio}x\t${durationSec}\tDISCARD\t${proposal.hypothesis.replace(/\t/g, ' ')}\n`;
      appendFileSync(resolve(process.cwd(), 'results.tsv'), tsvLine, 'utf-8');
      this.broadcast('log', `❌ [DISCARD] Pareto Score: ${metrics.pareto_score.toFixed(4)} >= best ${prevBestScore.toFixed(4)}. Discarded changes.`);
    }

    // 7. Persist to DB & broadcast
    db.insertExperiment({
      iteration: iter,
      hypothesis: proposal.hypothesis,
      rationale: proposal.rationale,
      code_diff: codeDiff,
      bpw: metrics.bpw,
      degradation_pct: metrics.degradation_pct,
      pareto_score: metrics.pareto_score,
      compression_ratio: metrics.compression_ratio,
      duration_sec: durationSec,
      status: status,
      stdout,
      stderr
    });

    this.broadcast('experiment_completed', {
      iteration: iter,
      hypothesis: proposal.hypothesis,
      metrics,
      status,
      durationSec
    });
  }

  runExperimentProcess(niceLevel, timeoutSec) {
    return new Promise((resolvePromise) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Use nice to avoid monopolizing VPS CPU
      const cmd = niceLevel > 0 ? 'nice' : 'python3';
      const args = niceLevel > 0 ? ['-n', niceLevel.toString(), 'python3', 'train.py'] : ['train.py'];

      const child = spawn(cmd, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      this.activeChild = child;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutSec * 1000);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        this.broadcast('stdout', text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        this.broadcast('stderr', text);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        this.activeChild = null;
        resolvePromise({ code, stdout, stderr, timedOut });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.activeChild = null;
        resolvePromise({ code: 1, stdout, stderr: err.message, timedOut: false });
      });
    });
  }
}

export const runner = new ResearchRunner();
