#!/usr/bin/env bash
# Run on Render after `pip install -r requirements.txt`.
# Keeps browsers inside the repo so runtime finds them (same PLAYWRIGHT_BROWSERS_PATH as browser_pdf.py on RENDER).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$ROOT/.playwright-browsers}"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
python -m playwright install --with-deps chromium
