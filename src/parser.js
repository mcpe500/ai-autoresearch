// src/parser.js - Robust Metrics Block Parser
export function parseExperimentOutput(stdout) {
  if (!stdout) return null;

  const result = {};
  const lines = stdout.split('\n');
  let delimiterFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      delimiterFound = true;
      continue;
    }

    if (delimiterFound) {
      const match = trimmed.match(/^([a-z_]+):\s+([0-9\.\-+eE]+)(x|mb|s)?/i);
      if (match) {
        const key = match[1].toLowerCase();
        const val = parseFloat(match[2]);
        if (!isNaN(val)) {
          result[key] = val;
        }
      }
    }
  }

  // Verify essential metrics are present
  if (result.bpw !== undefined && result.pareto_score !== undefined && result.degradation_pct !== undefined) {
    return {
      bpw: Number(result.bpw.toFixed(4)),
      degradation_pct: Number(result.degradation_pct.toFixed(4)),
      pareto_score: Number(result.pareto_score.toFixed(4)),
      compression_ratio: result.compression_ratio ? Number(result.compression_ratio.toFixed(2)) : Number((16.0 / result.bpw).toFixed(2)),
      total_weights: result.total_weights || null,
      total_bits: result.total_bits || null,
      training_seconds: result.training_seconds || 0,
      peak_vram_mb: result.peak_vram_mb || 0,
    };
  }

  return null;
}
