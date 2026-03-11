#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

require_cmd npm
require_cmd python3

log "Compilation frontend (lint + build)"
cd "$ROOT_DIR"
npm ci
npm run lint
npm run build

log "Compilation document_engine (compileall + tests)"
TMP_VENV="/tmp/virtuadoc-ci-$$"
python3 -m venv "$TMP_VENV"
# shellcheck source=/dev/null
source "$TMP_VENV/bin/activate"
pip install --upgrade pip >/dev/null
pip install -r "$ROOT_DIR/document_engine/requirements-ci.txt" >/dev/null
python -m compileall -q "$ROOT_DIR/document_engine"
pytest -q "$ROOT_DIR/document_engine/tests"
deactivate
rm -rf "$TMP_VENV"

log "Compilation terminée"
