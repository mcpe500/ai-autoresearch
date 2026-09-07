# ⚡ AutoResearch: Universal Sub-1-Bit Neural Quantizer Harness

An autonomous AI research harness inspired by Karpathy's [`autoresearch`](https://github.com/karpathy/autoresearch), tailored specifically to discover algorithms for **Universal Sub-1-Bit Neural Quantization (< 1.0 BPW)** based on [`goal.md`](goal.md).

Designed to be **ultra-lightweight** and run continuously for **hundreds of hours** even on a cheap, low-spec VPS (1–2 vCPU, 1–2 GB RAM, no GPU) with **zero external npm dependencies**.

---

## 🏗️ System Architecture

```
ai-autoresearch/
├── prepare.py              # [FIXED] Canonical Neural IR (256x256..512x512), BPW bit-accounting & evaluator
├── train.py                # [MUTABLE] Model A Universal Sub-1-Bit Quantizer (modified by AI agent)
├── program.md              # [PROTOCOL] Agent instructions & research agenda from goal.md
├── results.tsv             # [LOG] Experiment tracking log
│
├── src/                    # Zero-dependency Dual-Runtime Harness (Bun & Node.js)
│   ├── index.js            # CLI router (start, step, status, reset)
│   ├── config.js           # Zero-dependency .env loader & runtime settings
│   ├── runner.js           # 100+ hour continuous loop controller (nice -n 10, subprocess isolation)
│   ├── llm.js              # Universal OpenAI/9router API client (native fetch + backoff)
│   ├── git.js              # Git branch, commit, and rollback manager
│   ├── db.js               # Universal SQLite storage (node:sqlite)
│   ├── parser.js           # Metrics block parser (--- bpw: ...)
│   ├── server.js           # Native node:http server + Server-Sent Events (SSE) live stream
│   ├── tunnel.js           # Cloudflare Tunnel supervisor (auto trycloudflare URL)
│   └── ui/
│       └── index.html      # High-tech Dark-Mode Research Dashboard
│
├── scripts/
│   ├── install_cloudflared.sh  # Standalone cloudflared binary downloader
│   └── setup_vps_service.sh    # Systemd service installer for auto-start on VPS boot
└── harness                 # Universal launcher (auto-detects bun -> fallback node)
```

---

## 🚀 Quick Start

### 1. Configure Credentials (`.env`)

Copy `.env.example` and set your OpenAI-compatible API key (e.g. 9router):

```bash
cp .env.example .env
```

Edit `.env`:
```ini
OPENAI_API_BASE=https://api.9router.com/v1
OPENAI_API_KEY=your_api_key_here
MODEL_NAME=claude-3-7-sonnet
EXPERIMENT_TIMEOUT_SEC=60
PROCESS_NICE=10
```

*(Note: You can also update these directly in the Web UI Settings modal!)*

---

### 2. Launch the Harness & Web UI

Start the backend runner and open a public Cloudflare Tunnel:

```bash
./harness start --tunnel
```

Output:
```
======================================================
🔥 AUTORESEARCH HARNESS BACKEND & WEB UI
📡 Local Server: http://localhost:8000
🌐 CLOUDFLARE TUNNEL ONLINE!
👉 Remote Dashboard: https://your-subdomain.trycloudflare.com
======================================================
```

Open the link from your phone or PC to access the real-time research dashboard!

---

## 🛠️ CLI Commands

| Command | Description |
| :--- | :--- |
| `./harness start` | Start backend daemon + Web UI on `http://localhost:8000` |
| `./harness start --tunnel` | Start daemon + Web UI + public Cloudflare Tunnel |
| `./harness step` | Execute exactly one research iteration and exit |
| `./harness status` | Show formatted summary of completed experiments |
| `./harness reset` | Discard uncommitted changes and restore `train.py` to baseline |

---

## 📊 Features

1. **Ultra-Lightweight (< 50 MB RAM)**:
   - Built using standard built-ins (`node:sqlite`, `node:http`, `globalThis.fetch`, `node:child_process`).
   - Runs natively on **Bun** (~15 MB RAM) with automatic fallback to **Node.js** (~35 MB RAM).
   - **Zero `npm install` needed** — no multi-gigabyte `node_modules`.
2. **Subprocess Isolation**:
   - Each experiment runs as an isolated Python subprocess with `nice -n 10` priority.
   - When an experiment finishes, 100% of RAM/VRAM is reclaimed by the Linux kernel. No memory leaks over 100+ continuous hours.
3. **Calibrated Canonical Neural IR (`prepare.py`)**:
   - Benchmarks MLP ($256 \times 256$), Conv feature ($128 \times 128$), and Attention ($512 \times 512$) layer weights.
   - Runs in ~3 seconds on 1 vCPU, enabling hundreds of iterations per day on cheap VPSs.
4. **Interactive Web Dashboard**:
   - Live streaming terminal logs via Server-Sent Events (SSE).
   - Interactive Pareto Frontier scatter chart (BPW vs Functional Degradation %).
   - Git diff viewer showing exact code mutations made to `train.py`.
   - Start / Pause / Resume / Step controls.
5. **Cheap VPS Auto-Start (systemd)**:
   - Run `./scripts/setup_vps_service.sh` to install a persistent systemd service with `Restart=always` so the harness automatically resumes if the VPS reboots.
