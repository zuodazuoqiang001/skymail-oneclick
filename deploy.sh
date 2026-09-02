#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export NODE_USE_ENV_PROXY=1

run_with_node() {
  exec "$1" deploy.mjs "$@"
}

if command -v node >/dev/null 2>&1; then
  exec node deploy.mjs "$@"
fi

echo "Node.js not found. Downloading portable Node 22..."
VER=22.20.0
OS=linux
case "$(uname -s)" in
  Darwin) OS=darwin ;;
esac
ARCH=x64
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
esac
NAME="node-v${VER}-${OS}-${ARCH}.tar.gz"
TOOLS="work/tools"
mkdir -p "$TOOLS"
HOME_DIR="$TOOLS/node"
if [[ -x "$HOME_DIR/bin/node" ]]; then
  exec "$HOME_DIR/bin/node" deploy.mjs "$@"
fi
ok=0
for url in \
  "https://nodejs.org/dist/v${VER}/${NAME}" \
  "https://npmmirror.com/mirrors/node/v${VER}/${NAME}" \
  "https://cdn.npmmirror.com/binaries/node/v${VER}/${NAME}"
do
  echo "Download $url"
  if command -v curl >/dev/null 2>&1 && curl -L --fail --connect-timeout 20 -o "$TOOLS/$NAME" "$url"; then
    ok=1
    break
  fi
done
if [[ "$ok" != 1 ]]; then
  echo "Failed to download Node.js 22. Install from https://nodejs.org/ and retry."
  exit 1
fi
mkdir -p "$HOME_DIR"
tar -xf "$TOOLS/$NAME" -C "$TOOLS"
TOP=$(ls -1d "$TOOLS"/node-v${VER}-* 2>/dev/null | head -n 1)
if [[ -n "${TOP:-}" && -d "$TOP" ]]; then
  cp -R "$TOP"/. "$HOME_DIR"/
  rm -rf "$TOP"
fi
rm -f "$TOOLS/$NAME"
if [[ ! -x "$HOME_DIR/bin/node" ]]; then
  echo "Portable Node extract failed"
  exit 1
fi
exec "$HOME_DIR/bin/node" deploy.mjs "$@"