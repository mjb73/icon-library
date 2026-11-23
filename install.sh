#!/usr/bin/env bash
# Create the virtualenv and install the pinned dependencies from vendor/wheels.
# No network access is needed.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
if ! "$PY" - <<'PY'
import sys
sys.exit(0 if (3, 12) <= sys.version_info[:2] <= (3, 14) else 1)
PY
then
  echo "Python 3.12, 3.13 or 3.14 is required (found $("$PY" -V 2>&1))." >&2
  exit 1
fi

[ -d venv ] || "$PY" -m venv venv
./venv/bin/python -m pip install --no-index --find-links vendor/wheels -r requirements.txt

echo
echo "Done. Start it with ./run.sh (icon data and fonts are bundled)."
