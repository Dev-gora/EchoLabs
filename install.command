#!/bin/sh
# One-click installer for macOS - double-click this file in Finder.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org (or: brew install node)"
  echo "then double-click this installer again."
  printf '\nPress Enter to close...'
  read -r _
  exit 1
fi

node scripts/fusion/install.mjs "$@"

printf '\nPress Enter to close...'
read -r _
