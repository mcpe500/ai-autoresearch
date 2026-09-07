// src/index.js - Universal Dual-Runtime CLI Router (Bun & Node.js)
import { config } from './config.js';
import { db } from './db.js';
import { git } from './git.js';
import { runner } from './runner.js';
import { startServer } from './server.js';
import { tunnel } from './tunnel.js';

const args = process.argv.slice(2);
const command = args[0] || 'start';
const hasTunnelFlag = args.includes('--tunnel');

async function main() {
  const runtime = typeof Bun !== 'undefined' ? `Bun v${Bun.version}` : `Node.js ${process.version}`;
  console.log(`[Harness] Runtime: ${runtime} | PID: ${process.pid}`);

  if (command === 'start') {
    const port = config.get('PORT');
    const host = config.get('HOST');
    const enableTunnel = hasTunnelFlag || config.get('ENABLE_CLOUDFLARE_TUNNEL');

    // 1. Start Web Server
    startServer(port, host);

    // 2. Start Cloudflare Tunnel if requested
    if (enableTunnel) {
      tunnel.start(port);
    }

    // 3. Start AutoResearch Engine
    console.log('[Harness] Initializing research engine in IDLE mode. Ready to start from UI or CLI!');
    // Keep process running
  } else if (command === 'step') {
    console.log('[Harness] Executing single research iteration...');
    await runner.runStep();
    console.log('[Harness] Iteration complete.');
    process.exit(0);
  } else if (command === 'status') {
    const experiments = db.getAllExperiments();
    const best = db.getBestExperiment();
    console.log('\n======================================================');
    console.log('📊 AUTORESEARCH EXPERIMENT STATUS');
    console.log('======================================================');
    console.log(`Total Experiments: ${experiments.length}`);
    if (best) {
      console.log(`Best Pareto Score: ${best.pareto_score} (Iteration #${best.iteration})`);
      console.log(`Best BPW:          ${best.bpw}`);
      console.log(`Best Degradation:  ${best.degradation_pct}%`);
      console.log(`Best Hypothesis:   ${best.hypothesis}`);
    } else {
      console.log('No kept experiments recorded yet.');
    }
    console.log('------------------------------------------------------');
    console.log('Recent 5 runs:');
    for (const exp of experiments.slice(0, 5)) {
      console.log(` #${exp.iteration} [${exp.status}] BPW=${exp.bpw} Deg=${exp.degradation_pct}% Pareto=${exp.pareto_score} | ${exp.hypothesis.slice(0, 45)}...`);
    }
    console.log('======================================================\n');
    process.exit(0);
  } else if (command === 'reset') {
    console.log('[Harness] Resetting workspace to baseline...');
    git.discard('train.py');
    console.log('[Harness] train.py restored to clean HEAD commit.');
    process.exit(0);
  } else {
    console.log(`
Usage:
  ./harness start [--tunnel]   Start background daemon + Web UI (+ Cloudflare Tunnel)
  ./harness step               Execute exactly one research iteration
  ./harness status             Display summary of completed experiments
  ./harness reset              Discard uncommitted changes and restore train.py
`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`[Fatal Error] ${err.message}`);
  process.exit(1);
});
