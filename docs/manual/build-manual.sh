#!/usr/bin/env bash
#
# Rebuild the Player's Manual (markdown + PDF) with one command.
#
# Bootstraps a self-contained Python virtualenv at docs/manual/.venv,
# installs the pinned dependencies (reportlab) on first run, then runs the
# full pipeline in docs/manual/build_all.py:
#
#   build_class_gallery.py  build_items.py  build_monsters.py
#   build_spells.py   -> rewrite their blocks in manual.md
#   build_manual.py   -> render manual.md to manual.pdf (+ sync web/public)
#
# Usage:
#   npm run build:manual          # from web/  (preferred)
#   docs/manual/build-manual.sh   # directly, from anywhere
#
# Any extra arguments are passed straight through to build_all.py.

set -euo pipefail

# Resolve this script's own directory so it works regardless of cwd.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"
REQS="$HERE/requirements.txt"

# Pick a Python 3 interpreter to seed the venv.
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "error: '$PYTHON' not found on PATH. Install Python 3 or set PYTHON=." >&2
  exit 1
fi

# Create the venv on first run. Normally `python -m venv` bundles pip via
# ensurepip; some minimal Linux Pythons ship without it, so fall back to a
# pip-less venv and bootstrap pip from the host interpreter.
if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating virtualenv at $VENV ..."
  if ! "$PYTHON" -m venv "$VENV" 2>/dev/null; then
    echo "  (bundled pip unavailable; bootstrapping pip manually)"
    rm -rf "$VENV"
    "$PYTHON" -m venv --without-pip "$VENV"
    "$PYTHON" -m pip --python "$VENV/bin/python" install --quiet --upgrade pip
  fi
fi

VENV_PY="$VENV/bin/python"

# Install/refresh dependencies only when something is actually missing, so
# repeat runs stay fast. The marker tracks the requirements file's checksum;
# editing requirements.txt triggers a reinstall on the next run.
sum_cmd() { if command -v shasum >/dev/null 2>&1; then shasum "$1"; else md5sum "$1"; fi; }
REQS_SUM="$(sum_cmd "$REQS" | awk '{print $1}')"
MARKER="$VENV/.requirements.sha"

if ! "$VENV_PY" -c "import reportlab" >/dev/null 2>&1 \
   || [ "$(cat "$MARKER" 2>/dev/null || true)" != "$REQS_SUM" ]; then
  echo "Installing manual build dependencies ..."
  "$VENV_PY" -m pip install --quiet --upgrade pip
  "$VENV_PY" -m pip install --quiet -r "$REQS"
  echo "$REQS_SUM" > "$MARKER"
fi

# Run the full rebuild.
exec "$VENV_PY" "$HERE/build_all.py" "$@"
