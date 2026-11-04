#!/bin/sh
# Stops everything start_fusion.command started (macOS).
cd "$(dirname "$0")" || exit 1

node scripts/fusion/stop.mjs

if [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ]; then
  sleep 1
  osascript -e 'tell application "Terminal" to close (every window whose name contains "stop_fusion")' >/dev/null 2>&1
fi
