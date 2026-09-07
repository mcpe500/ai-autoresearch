// src/runner.js - Research Pipeline Coordinator with 7-Stage Visual State Machine
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { git } from './git.js';
import { llm } from './llm.js';
import { parseExperimentOutput } from './parser.js';

export const STAGES = {
  1: { id: 1, name: 'BRAINSTORMING', label: 'Brainstorming' },
  2: { id: 2, name: 'AI_THINKING', label: 'AI Thinking' },
  3: { id: 3, name: 'GENERATING_CODE', label: 'Code Mutation' },
  4: { id: 4, name: 'LINTING_SYNTAX', label: 'Syntax Check' },
  5: { id: 5, name: 'RUNNING_EXPERIMENT', label: 'Running Subprocess' },
  6: { id: 6, name: 'EVALUATING_GROUND_TRUTH', label: 'Ground-Truth Eval' },
  7: { id: 7, name: 'DECIDING', label: 'Decision & Git' },
};

class ResearchRunner {
  constructor() {
    this.status = 'IDLE'; // IDLE | RUNNING | PAUSED | STOPPED
    this.currentIteration = 0;
    this.currentStage = 1;
    this.currentStageName = 'BRAINSTORMING';
    this.currentAction = 'System ready. Click Start Loop to begin autonomous research.';
    this.stageStartTime = Date.now();
    this.activeHypothesis = '';
    this.activeRationale = '';
    this.accumulatedThinking = '';
    this.accumulatedCode = '';
    this.recentLogs = []; // Ring buffer: { id, timestamp, type, text, stage }
    this.logCounter = 0;
    this.subscribers = new Set();
    this.lastError = null;
    this.activeChild = null;
    this.startTime = Date.now();
    this.isStepping = false;
    this.init();
  }

  init() {
    this.currentIteration = db.getState('current_iteration', 0);
    this.bestScore = db.getState('best_pareto_score', 17.9602);
    this.bestBpw = db.getState('best_bpw', 0.5609);
  }

  getStageElapsed() {
    return Number(((Date.now() - this.stageStartTime) / 1000).toFixed(1));
  }

  setStage(stageNum, actionText = '') {
    this.currentStage = stageNum;
    this.currentStageName = STAGES[stageNum]?.name || 'UNKNOWN';
    this.stageStartTime = Date.now();
    if (actionText) this.currentAction = actionText;

    this.appendLog('stage_change', `[STAGE ${stageNum}: ${STAGES[stageNum]?.label}] ${this.currentAction}`);
    this.broadcast('stage_change', {
      stage: this.currentStage,
      stage_name: this.currentStageName,
      stage_label: STAGES[stageNum]?.label,
      action: this.currentAction,
      iteration: this.currentIteration,
    });
  }

  setAction(text) {
    this.currentAction = text;
    this.broadcast('action_update', {
      action: this.currentAction,
      stage: this.currentStage,
      elapsed: this.getStageElapsed(),
    });
  }

  appendLog(type, text) {
    this.logCounter++;
    const entry = {
      id: this.logCounter,
      timestamp: new Date().toISOString(),
      type, // 'log' | 'thinking' | 'code' | 'stdout' | 'stderr' | 'stage_change'
      text,
      stage: this.currentStage,
      stage_name: this.currentStageName,
    };

    this.recentLogs.push(entry);
    if (this.recentLogs.length > 1000) {
      this.recentLogs.shift();
    }

    this.broadcast('log_entry', entry);
  }

  getLogs(sinceId = 0) {
    if (sinceId <= 0) return this.recentLogs.slice(-250);
    return this.recentLogs.filter(l => l.id > sinceId);
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
    this.broadcast('status_change', {
      status: this.status,
      iteration: this.currentIteration,
      current_stage: this.currentStage,
      current_action: this.currentAction,
    });
  }

  async start() {
    if (this.status === 'RUNNING') return;
    this.setStatus('RUNNING');
    git.ensureBranch();
    this.runLoop();
  }

  pause() {
    this.setStatus('PAUSED');
    this.setAction('Paused by user. Current experiment will complete before halting.');
  }

  resume() {
    if (this.status === 'PAUSED' || this.status === 'IDLE') {
      this.setStatus('RUNNING');
      this.runLoop();
    }
  }

  async runStep() {
    if (this.status === 'RUNNING') return;
    this.isStepping = true;
    this.setStatus('RUNNING');
    await this.executeSingleIteration();
    this.setStatus('PAUSED');
    this.isStepping = false;
  }

  async runLoop() {
    while (this.status === 'RUNNING') {
      await this.executeSingleIteration();
      if (this.status === 'RUNNING') {
        this.setAction('Resting 2s to protect VPS CPU before next iteration...');
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  async executeSingleIteration() {
    this.currentIteration++;
    db.setState('current_iteration', this.currentIteration);
    const iter = this.currentIteration;

    // Reset iteration-specific accumulators
    this.accumulatedThinking = '';
    this.accumulatedCode = '';
    this.activeHypothesis = `Formulating hypothesis for experiment #${iter}...`;
    this.activeRationale = '';

    // =========================================================================
    // STAGE 1: BRAINSTORMING & CONTEXT ASSEMBLY
    // =========================================================================
    this.setStage(1, `Reading previous experiment history & assembling context for Iteration #${iter}...`);
    this.appendLog('log', `\n======================================================\n🚀 Starting Autonomous Experiment #${iter}\n======================================================`);
    this.appendLog('log', `[TOOL: context] Reading program.md, train.py, and checking last 5 experiment records...`);

    const programPrompt = readFileSync(resolve(process.cwd(), 'program.md'), 'utf-8');
    const currentCode = readFileSync(resolve(process.cwd(), 'train.py'), 'utf-8');
    const history = db.getAllExperiments().slice(0, 5);

    // =========================================================================
    // STAGE 2: AI THINKING & LIVE REASONING STREAM
    // =========================================================================
    const apiBase = config.get('OPENAI_API_BASE');
    const model = config.get('MODEL_NAME');
    this.setStage(2, `AI Scientist is analyzing model architectures & reasoning in real-time...`);
    this.appendLog('log', `[TOOL: llm_stream] Requesting completion from ${model} via ${apiBase}...`);

    let proposal;
    let tokenBatch = 0;
    let lastHeartbeatTime = Date.now();
    let lastStageTransitionToCode = false;

    try {
      proposal = await llm.generateNextExperiment({
        programPrompt,
        currentCode,
        history,
        lastError: this.lastError,
        onAction: (act) => this.setAction(act),
        onToken: ({ type, token, count }) => {
          if (type === 'thinking') {
            this.accumulatedThinking += token;
            this.broadcast('thinking_token', { token, count });
          } else if (type === 'code') {
            if (!lastStageTransitionToCode) {
              lastStageTransitionToCode = true;
              this.setStage(3, `AI Scientist is generating the Python code mutation for train.py...`);
              this.appendLog('log', `[STAGE 3: Code Mutation] Finished conceptual planning; synthesising candidate train.py...`);
            }
            this.accumulatedCode += token;
            this.broadcast('code_token', { token, count });
          }

          tokenBatch++;
          const now = Date.now();
          if (tokenBatch >= 35 || (now - lastHeartbeatTime > 3000 && tokenBatch > 5)) {
            const elapsed = this.getStageElapsed();
            if (this.currentStage === 2) {
              this.appendLog('log', `[AI THINKING] Streamed ~${count || tokenBatch} reasoning tokens [${elapsed}s elapsed]...`);
              this.setAction(`AI Scientist reasoning... (~${count || tokenBatch} tokens, ${elapsed}s)`);
            } else if (this.currentStage === 3) {
              const lineCount = (this.accumulatedCode.match(/\n/g) || []).length;
              this.appendLog('log', `[AI CODE] Streamed ~${count || tokenBatch} code tokens (${lineCount} lines) [${elapsed}s elapsed]...`);
              this.setAction(`Generating train.py mutation... (${lineCount} lines, ${elapsed}s)`);
            }
            tokenBatch = 0;
            lastHeartbeatTime = now;
          }
        },
      });
    } catch (err) {
      this.appendLog('stderr', `[ERROR] LLM generation failed: ${err.message}`);
      this.lastError = err.message;
      this.setAction(`LLM Error: ${err.message}. Pausing harness.`);
      this.setStatus('PAUSED');
      return;
    }

    this.activeHypothesis = proposal.hypothesis;
    this.activeRationale = proposal.rationale;
    this.broadcast('hypothesis', {
      iteration: iter,
      hypothesis: proposal.hypothesis,
      rationale: proposal.rationale,
      reasoning: proposal.reasoning,
    });

    this.appendLog('log', `[TOOL: parse] Parsed proposal. Code block size: ${proposal.code?.length || 0} bytes.`);
    this.appendLog('log', `💡 Hypothesis: ${proposal.hypothesis}`);
    if (proposal.rationale) {
      this.appendLog('log', `📖 Rationale: ${proposal.rationale}`);
    }

    if (!proposal.code) {
      this.appendLog('stderr', `[ERROR] LLM did not return complete code block. Skipping iteration.`);
      this.lastError = 'FormatError: No Python code block found in response.';
      return;
    }

    // =========================================================================
    // STAGE 4: LINTING & SYNTAX VALIDATION
    // =========================================================================
    this.setStage(4, `Writing candidate code to train.py and validating Python syntax with py_compile...`);
    this.appendLog('log', `[TOOL: write_file] Writing candidate code to train.py (${proposal.code.length} bytes)...`);
    writeFileSync(resolve(process.cwd(), 'train.py'), proposal.code, 'utf-8');

    this.appendLog('log', `[TOOL: git diff] Computing candidate diff...`);
    const codeDiff = git.getDiff('train.py');

    this.appendLog('log', `[TOOL: py_compile] Checking syntax with python3 -m py_compile train.py...`);
    try {
      execSync('python3 -m py_compile train.py', { stdio: 'pipe' });
      this.appendLog('log', `✓ [TOOL: py_compile] Syntax validation passed. No compilation errors detected.`);
    } catch (syntaxErr) {
      this.appendLog('stderr', `✗ [TOOL: py_compile] Syntax validation failed. Rolling back candidate.`);
      git.discard('train.py');
      this.lastError = `SyntaxError: Code provided in iteration #${iter} failed python py_compile.`;
      db.insertExperiment({
        iteration: iter,
        hypothesis: proposal.hypothesis,
        rationale: proposal.rationale,
        code_diff: codeDiff,
        status: 'CRASH',
        stderr: this.lastError,
      });
      return;
    }

    // =========================================================================
    // STAGE 5: RUNNING EXPERIMENT IN ISOLATED SUBPROCESS
    // =========================================================================
    const timeoutSec = config.get('EXPERIMENT_TIMEOUT_SEC');
    const niceLevel = config.get('PROCESS_NICE');
    this.setStage(5, `Running python3 train.py on CPU with nice -n ${niceLevel} (Timeout: ${timeoutSec}s)...`);
    this.appendLog('log', `[TOOL: spawn] Launching isolated subprocess: nice -n ${niceLevel} python3 train.py (Timeout: ${timeoutSec}s)...`);

    const startTime = Date.now();
    const { code, stdout, stderr, timedOut } = await this.runExperimentProcess(niceLevel, timeoutSec);
    const durationSec = Number(((Date.now() - startTime) / 1000).toFixed(2));

    // =========================================================================
    // STAGE 6: GROUND-TRUTH EVALUATION
    // =========================================================================
    this.setStage(6, `Auditing bit-accounting & evaluating Canonical Neural IR distortion...`);
    this.appendLog('log', `[TOOL: evaluate_quantizer] Auditing bitstream and checking Canonical Neural IR distortion...`);

    if (timedOut) {
      this.appendLog('stderr', `[TIMEOUT] Experiment exceeded ${timeoutSec}s limit. Discarding.`);
      git.discard('train.py');
      this.lastError = `TimeoutError: Script took > ${timeoutSec}s. Optimize matrix operations.`;
      db.insertExperiment({
        iteration: iter,
        hypothesis: proposal.hypothesis,
        rationale: proposal.rationale,
        code_diff: codeDiff,
        duration_sec: durationSec,
        status: 'CRASH',
        stderr: this.lastError,
      });
      return;
    }

    if (code !== 0) {
      this.appendLog('stderr', `[CRASH] Experiment exited with code ${code}. Error:\n${stderr.slice(-300)}`);
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
        stderr,
      });
      return;
    }

    const metrics = parseExperimentOutput(stdout);
    if (!metrics) {
      this.appendLog('stderr', `[ERROR] Could not parse standard delimiter block (--- bpw: ...).`);
      git.discard('train.py');
      this.lastError = `FormatError: Output did not contain valid metrics block.`;
      db.insertExperiment({
        iteration: iter,
        hypothesis: proposal.hypothesis,
        rationale: proposal.rationale,
        code_diff: codeDiff,
        duration_sec: durationSec,
        status: 'CRASH',
        stdout,
        stderr: this.lastError,
      });
      return;
    }

    // =========================================================================
    // STAGE 7: DECISION & VERSION CONTROL
    // =========================================================================
    this.lastError = null;
    const prevBestScore = this.bestScore;
    const isImprovement = metrics.pareto_score < prevBestScore;
    this.appendLog('log', `[TOOL: decision] Checking Pareto: candidate ${metrics.pareto_score.toFixed(4)} vs current best ${prevBestScore.toFixed(4)}...`);

    let status = 'DISCARD';
    if (isImprovement) {
      status = 'KEEP';
      this.bestScore = metrics.pareto_score;
      this.bestBpw = metrics.bpw;
      db.setState('best_pareto_score', this.bestScore);
      db.setState('best_bpw', this.bestBpw);

      const tsvLine = `${iter}\texp-${iter}\t${metrics.bpw}\t${metrics.degradation_pct}\t${metrics.pareto_score}\t${metrics.compression_ratio}x\t${durationSec}\tKEEP\t${proposal.hypothesis.replace(/\t/g, ' ')}\n`;
      appendFileSync(resolve(process.cwd(), 'results.tsv'), tsvLine, 'utf-8');

      this.appendLog('log', `[TOOL: git commit] Creating commit exp-${iter}...`);
      const commitHash = git.commit(iter, proposal.hypothesis);
      this.setStage(7, `✅ IMPROVEMENT! Pareto: ${metrics.pareto_score} < ${prevBestScore}. Committed: ${commitHash}`);
      this.appendLog('log', `✅ [IMPROVEMENT] Pareto Score: ${metrics.pareto_score.toFixed(4)} < ${prevBestScore.toFixed(4)} (BPW: ${metrics.bpw}, Deg: ${metrics.degradation_pct}%). COMMITTED (${commitHash})!`);
    } else {
      this.appendLog('log', `[TOOL: git checkout] Discarding candidate changes...`);
      git.discard('train.py');
      const tsvLine = `${iter}\tdiscarded\t${metrics.bpw}\t${metrics.degradation_pct}\t${metrics.pareto_score}\t${metrics.compression_ratio}x\t${durationSec}\tDISCARD\t${proposal.hypothesis.replace(/\t/g, ' ')}\n`;
      appendFileSync(resolve(process.cwd(), 'results.tsv'), tsvLine, 'utf-8');
      this.setStage(7, `❌ DISCARD. Pareto: ${metrics.pareto_score} >= ${prevBestScore}. Rolling back.`);
      this.appendLog('log', `❌ [DISCARD] Pareto Score: ${metrics.pareto_score.toFixed(4)} >= best ${prevBestScore.toFixed(4)}. Discarded changes.`);
    }

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
      stderr,
    });

    this.broadcast('experiment_completed', {
      iteration: iter,
      hypothesis: proposal.hypothesis,
      metrics,
      status,
      durationSec,
    });
  }

  runExperimentProcess(niceLevel, timeoutSec) {
    return new Promise((resolvePromise) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

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
        this.appendLog('stdout', text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        this.appendLog('stderr', text);
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
