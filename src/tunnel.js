// src/tunnel.js - Cloudflare Tunnel Supervisor
import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';

export class TunnelManager {
  constructor() {
    this.process = null;
    this.publicUrl = null;
    this.isStarting = false;
  }

  getCloudflaredPath() {
    try {
      execSync('which cloudflared', { stdio: 'pipe' });
      return 'cloudflared';
    } catch {}

    const localBin = resolve(process.cwd(), 'bin', 'cloudflared');
    if (existsSync(localBin)) {
      return localBin;
    }

    return null;
  }

  ensureInstalled() {
    let binPath = this.getCloudflaredPath();
    if (!binPath) {
      console.log('[Tunnel] cloudflared not found. Auto-installing standalone binary...');
      const installScript = resolve(process.cwd(), 'scripts', 'install_cloudflared.sh');
      execSync(`bash "${installScript}"`, { stdio: 'inherit' });
      binPath = this.getCloudflaredPath();
    }
    return binPath;
  }

  start(port = 8000) {
    if (this.process) return;
    this.isStarting = true;

    let bin;
    try {
      bin = this.ensureInstalled();
    } catch (err) {
      console.error(`[Tunnel] Failed to prepare cloudflared: ${err.message}`);
      this.isStarting = false;
      return;
    }

    const token = config.get('CLOUDFLARE_TUNNEL_TOKEN');
    let args = [];

    if (token) {
      args = ['tunnel', 'run', '--token', token];
    } else {
      // Zero-config Quick Tunnel via trycloudflare.com
      args = ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'];
    }

    console.log(`[Tunnel] Spawning cloudflared: ${bin} ${args.join(' ')}`);
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;

    const handleLog = (data) => {
      const line = data.toString();
      // Match trycloudflare regex: https://[a-zA-Z0-9-]+\.trycloudflare\.com
      const match = line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !this.publicUrl) {
        this.publicUrl = match[0];
        writeFileSync(resolve(process.cwd(), 'tunnel_url.txt'), this.publicUrl, 'utf-8');
        console.log(`\n======================================================`);
        console.log(`🌐 CLOUDFLARE TUNNEL ONLINE!`);
        console.log(`👉 Remote Dashboard: ${this.publicUrl}`);
        console.log(`======================================================\n`);
      }
    };

    child.stdout.on('data', handleLog);
    child.stderr.on('data', handleLog);

    child.on('close', (code) => {
      console.warn(`[Tunnel] cloudflared exited with code ${code}.`);
      this.process = null;
      this.publicUrl = null;
      try { unlinkSync(resolve(process.cwd(), 'tunnel_url.txt')); } catch {}
      // Auto-reconnect after 5 seconds if still enabled
      if (config.get('ENABLE_CLOUDFLARE_TUNNEL')) {
        setTimeout(() => this.start(port), 5000);
      }
    });

    child.on('error', (err) => {
      console.error(`[Tunnel] Process error: ${err.message}`);
      this.process = null;
      this.publicUrl = null;
    });
  }

  stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this.publicUrl = null;
      try { unlinkSync(resolve(process.cwd(), 'tunnel_url.txt')); } catch {}
    }
  }

  getUrl() {
    return this.publicUrl;
  }
}

export const tunnel = new TunnelManager();
