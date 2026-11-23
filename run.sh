#!/usr/bin/env bash
# Start Icon Library on http://127.0.0.1:7876 (override with PORT=...).
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "Run ./install.sh first." >&2
  exit 1
fi
exec ./venv/bin/python server.py
