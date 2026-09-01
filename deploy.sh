#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export NODE_USE_ENV_PROXY=1
if ! command -v node >/dev/null 2>&1; then
  echo "Need Node.js 20+  https://nodejs.org/"
  exit 1
fi
exec node deploy.mjs "$@"