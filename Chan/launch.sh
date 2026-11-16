#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py "$@"
elif command -v python >/dev/null 2>&1; then
  exec python server.py "$@"
else
  echo "Python 3 is required for the local proxy server."
  echo "Alternatively, load this folder as an unpacked Chrome Extension at chrome://extensions"
  exit 1
fi
