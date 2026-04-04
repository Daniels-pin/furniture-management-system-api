#!/usr/bin/env bash
# Run on Render after `pip install -r requirements.txt` so headless Chromium and OS libs exist.
set -euo pipefail
python -m playwright install chromium
if command -v apt-get >/dev/null 2>&1; then
  python -m playwright install-deps chromium || true
fi
