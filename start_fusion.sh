#!/bin/sh
# Starts EchoLabs on http://localhost:5174: ./start_fusion.sh
# Services run detached; stop them with ./stop_fusion.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 18+ from https://nodejs.org then run this again."
  exit 1
fi

exec node scripts/fusion/start.mjs
