#!/bin/sh
# Installs EchoLabs dependencies on Linux/macOS: ./install.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 18+ from https://nodejs.org then run this again."
  exit 1
fi

exec node scripts/fusion/install.mjs "$@"
