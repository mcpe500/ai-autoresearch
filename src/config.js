// src/config.js - Zero-Dependency Configuration Loader
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env');

function parseEnvFile(filepath) {
  if (!existsSync(filepath)) return {};
  const content = readFileSync(filepath, 'utf-8');
  const config = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      config[key] = val;
    }
  }
  return config;
}

class ConfigManager {
  constructor() {
    this.reload();
  }

  reload() {
    const envFile = parseEnvFile(ENV_PATH);
    this.config = {
      OPENAI_API_BASE: process.env.OPENAI_API_BASE || envFile.OPENAI_API_BASE || 'https://api.9router.com/v1',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || envFile.OPENAI_API_KEY || '',
      MODEL_NAME: process.env.MODEL_NAME || envFile.MODEL_NAME || 'claude-3-7-sonnet',
      EXPERIMENT_TIMEOUT_SEC: parseInt(process.env.EXPERIMENT_TIMEOUT_SEC || envFile.EXPERIMENT_TIMEOUT_SEC || '60', 10),
      MAX_EXPERIMENTS: parseInt(process.env.MAX_EXPERIMENTS || envFile.MAX_EXPERIMENTS || '0', 10),
      PROCESS_NICE: parseInt(process.env.PROCESS_NICE || envFile.PROCESS_NICE || '10', 10),
      HOST: process.env.HOST || envFile.HOST || '0.0.0.0',
      PORT: parseInt(process.env.PORT || envFile.PORT || '8000', 10),
      ENABLE_CLOUDFLARE_TUNNEL: (process.env.ENABLE_CLOUDFLARE_TUNNEL || envFile.ENABLE_CLOUDFLARE_TUNNEL || 'false').toLowerCase() === 'true',
      CLOUDFLARE_TUNNEL_TOKEN: process.env.CLOUDFLARE_TUNNEL_TOKEN || envFile.CLOUDFLARE_TUNNEL_TOKEN || '',
    };
  }

  get(key) {
    return this.config[key];
  }

  getAll() {
    return { ...this.config };
  }

  update(newValues) {
    for (const [key, val] of Object.entries(newValues)) {
      if (key in this.config) {
        this.config[key] = val;
      }
    }
    // Save to .env
    const lines = [];
    for (const [k, v] of Object.entries(this.config)) {
      lines.push(`${k}=${v}`);
    }
    writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
  }
}

export const config = new ConfigManager();
