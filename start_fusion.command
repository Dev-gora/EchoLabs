#!/bin/sh
# Starts EchoLabs on http://localhost:5174 (macOS - double-click in Finder).
# Services run in the background; stop them with stop_fusion.command.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org (or: brew install node)"
  echo "then run the installer and try again."
  printf '\nPress Enter to close...'
  read -r _
  exit 1
fi

node scripts/fusion/start.mjs
status=$?

# Close the Terminal window this file opened, instead of leaving it stacked up.
if [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ]; then
  sleep 2
  osascript -e 'tell application "Terminal" to close (every window whose name contains "start_fusion")' >/dev/null 2>&1
fi

exit $status
