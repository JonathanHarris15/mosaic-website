#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for mosaic-website.
# Two npm packages, two lockfiles. Always converge from the lockfiles;
# never rewrite them. Safe to re-run on a warm disk.
set -euo pipefail

cd "$(dirname "$0")/.."

npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund
