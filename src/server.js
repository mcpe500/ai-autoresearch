// src/server.js - Universal Zero-Dependency HTTP & SSE Server via node:http
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { runner } from './runner.js';
import { tunnel } from './tunnel.js';

const UI_PATH = resolve(process.cwd(), 'src', 'ui', 'index.html');

export function startServer(port = 8000, host = '0.0.0.0') {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Serve Dashboard HTML
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(UI_PATH, 'utf-8'));
      return;
    }

    // 2. Server-Sent Events (SSE) Live Stream
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');

      const unsubscribe = runner.subscribe((payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      });

      // Keep alive heartbeat every 15s
      const ping = setInterval(() => {
        res.write(': ping\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }

    // Helper for JSON responses
    const sendJson = (data, statusCode = 200) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // 3. Status API
    if (pathname === '/api/status' && req.method === 'GET') {
      sendJson({
        status: runner.status,
        iteration: runner.currentIteration,
        best_pareto_score: runner.bestScore,
        best_bpw: runner.bestBpw,
        tunnel_url: tunnel.getUrl(),
        uptime_sec: Math.round((Date.now() - runner.startTime) / 1000),
      });
      return;
    }

    // 4. Experiments API
    if (pathname === '/api/experiments' && req.method === 'GET') {
      sendJson(db.getAllExperiments());
      return;
    }

    // 5. Experiment Details API: /api/experiments/:id
    const expMatch = pathname.match(/^\/api\/experiments\/(\d+)$/);
    if (expMatch && req.method === 'GET') {
      const id = parseInt(expMatch[1], 10);
      const row = db.getExperimentById(id);
      if (row) sendJson(row);
      else sendJson({ error: 'Not found' }, 404);
      return;
    }

    // 6. Control Actions: /api/control/:action
    const ctrlMatch = pathname.match(/^\/api\/control\/(start|pause|resume|step)$/);
    if (ctrlMatch && req.method === 'POST') {
      const action = ctrlMatch[1];
      if (action === 'start') runner.start();
      else if (action === 'pause') runner.pause();
      else if (action === 'resume') runner.resume();
      else if (action === 'step') runner.runStep();
      sendJson({ success: true, action, status: runner.status });
      return;
    }

    // 7. Config API
    if (pathname === '/api/config') {
      if (req.method === 'GET') {
        const currentCfg = config.getAll();
        const masked = { ...currentCfg };
        if (masked.OPENAI_API_KEY) {
          masked.OPENAI_API_KEY = masked.OPENAI_API_KEY.slice(-4).padStart(masked.OPENAI_API_KEY.length, '*');
        }
        sendJson(masked);
        return;
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            // If user did not change masked key, keep original
            if (parsed.OPENAI_API_KEY && parsed.OPENAI_API_KEY.includes('***')) {
              delete parsed.OPENAI_API_KEY;
            }
            config.update(parsed);
            sendJson({ success: true });
          } catch (err) {
            sendJson({ error: err.message }, 400);
          }
        });
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(port, host, () => {
    console.log(`\n======================================================`);
    console.log(`🔥 AUTORESEARCH HARNESS BACKEND & WEB UI`);
    console.log(`📡 Local Server: http://localhost:${port}`);
    console.log(`======================================================\n`);
  });

  return server;
}
