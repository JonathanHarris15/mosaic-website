#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for mosaic-website.
# Two npm packages, two lockfiles. Always converge from the lockfiles;
# never rewrite them. Safe to re-run on a warm disk.
set -euo pipefail

cd "$(dirname "$0")/.."

npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund

# Optional: fastbrowse for jev-smoke-test skill (non-fatal; see .cursor/skills/jev-smoke-test/)
export PATH="${HOME}/.local/bin:${PATH:-}"
if command -v uv >/dev/null 2>&1 || pip install --user -q uv 2>/dev/null; then
  uv tool install -q fastbrowse 2>/dev/null || echo "fastbrowse install skipped"
fi
