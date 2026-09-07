#!/usr/bin/env bash
set -e

BIN_DIR="$(dirname "$0")/../bin"
mkdir -p "$BIN_DIR"
CLOUDFLARED_BIN="$BIN_DIR/cloudflared"

if [ -f "$CLOUDFLARED_BIN" ]; then
    echo "[cloudflared] Binary already present at $CLOUDFLARED_BIN"
    exit 0
fi

echo "[cloudflared] Downloading official standalone linux-amd64 binary..."
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)  TARGET="cloudflared-linux-amd64" ;;
    aarch64) TARGET="cloudflared-linux-arm64" ;;
    armv7l)  TARGET="cloudflared-linux-arm" ;;
    *)       TARGET="cloudflared-linux-amd64" ;;
esac

curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/$TARGET" -o "$CLOUDFLARED_BIN"
chmod +x "$CLOUDFLARED_BIN"
echo "[cloudflared] Download complete: $("$CLOUDFLARED_BIN" --version)"
