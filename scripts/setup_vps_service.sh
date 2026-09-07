#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/autoresearch.service"

mkdir -p "$SERVICE_DIR"

RUNNER_BIN="$(command -v bun || command -v node)"

cat << SERVICE > "$SERVICE_FILE"
[Unit]
Description=AutoResearch Autonomous Harness Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/harness start --tunnel
Restart=always
RestartSec=5s
Environment=PATH=$PATH:$HOME/.bun/bin:$HOME/.local/bin
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
SERVICE

echo "Systemd service created at: $SERVICE_FILE"
echo ""
echo "To enable and start the service:"
echo "  systemctl --user daemon-reload"
echo "  systemctl --user enable autoresearch.service"
echo "  systemctl --user start autoresearch.service"
echo ""
echo "To check status or logs:"
echo "  systemctl --user status autoresearch.service"
echo "  journalctl --user -u autoresearch.service -f"
