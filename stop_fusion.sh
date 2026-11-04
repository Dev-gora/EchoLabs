#!/bin/sh
# Stops everything start_fusion.sh started.
cd "$(dirname "$0")" || exit 1
exec node scripts/fusion/stop.mjs
