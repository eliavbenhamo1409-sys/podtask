#!/usr/bin/env bash
# Deploy the Next.js app to Vercel production.
#
# Vercel is connected to GitHub (eliavbenhamo1409-sys/podtask); every push to
# `main` triggers a production build. This script is deliberately narrow:
#   1. refuses to run with uncommitted changes (commit explicitly first, so a
#      stray working-tree edit never ships by accident)
#   2. runs the local gates: typecheck + lint
#   3. pushes main
#   4. polls the GitHub commit status that Vercel reports until it settles
#   5. prints the live URL (https://podtask.vercel.app)
#
# Usage:
#   scripts/deploy.sh               # gate, push HEAD, wait for Vercel
#   scripts/deploy.sh --wait-only   # only poll the current HEAD
set -euo pipefail

REPO="eliavbenhamo1409-sys/podtask"
LIVE_URL="https://podtask.vercel.app"
BRANCH="main"
TIMEOUT_SECS="${DEPLOY_TIMEOUT:-600}"

cd "$(git rev-parse --show-toplevel)"

if [[ "${1:-}" != "--wait-only" ]]; then
  if [[ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]]; then
    echo "✗ not on $BRANCH (on $(git rev-parse --abbrev-ref HEAD)); merge first" >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "✗ working tree has uncommitted changes; commit (or stash) them first:" >&2
    git status --short >&2
    exit 1
  fi

  npm run --silent check
  git push -q origin "$BRANCH"
fi

SHA="$(git rev-parse HEAD)"
echo "▲ pushed ${SHA:0:7} — waiting for Vercel…"

start=$(date +%s)
state="pending"
target=""
while true; do
  json="$(gh api "repos/$REPO/commits/$SHA/status" 2>/dev/null || echo '{}')"
  state="$(echo "$json" | jq -r '[.statuses[]? | select(.context=="Vercel")][0].state // "pending"')"
  target="$(echo "$json" | jq -r '[.statuses[]? | select(.context=="Vercel")][0].target_url // ""')"
  case "$state" in
    success) echo "✓ deployed: $LIVE_URL"; echo "  vercel: $target"; exit 0 ;;
    failure|error) echo "✗ deploy $state: $target" >&2; exit 1 ;;
  esac
  if (( $(date +%s) - start > TIMEOUT_SECS )); then
    echo "✗ timed out after ${TIMEOUT_SECS}s (state=$state)" >&2; exit 1
  fi
  sleep 10
done
