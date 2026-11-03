#!/usr/bin/env bash
# first-run helper for the EchoLabs frontend
# Run this from artifacts/fusion-coach after cloning or unzipping the project.
# This file is meant to be shared with other machines; it is not a package install script for the project itself.

set -e

step() {
  printf '\n==> %s\n' "$1"
}

ok() {
  printf '    OK: %s\n' "$1"
}

fail() {
  printf '    FAIL: %s\n' "$1" >&2
}

step '1) Ensure Node.js is available'
if ! command -v node >/dev/null 2>&1; then
  fail 'Node.js was not found on PATH.'
  echo '    Install Node.js from https://nodejs.org and then run this script again.' >&2
  exit 1
fi
ok "Node.js $(node --version)"

step '2) Install frontend dependencies'
if [ ! -d node_modules ]; then
  echo '    Running npm install (this may take a while the first time)...' >&2
  npm install
else
  ok 'node_modules already exists, skipping install'
fi

step '3) Prepare local environment file'
ENV_PATH=".env"
ENV_EXAMPLE_PATH=".env.example"

if [ ! -f "$ENV_PATH" ]; then
  if [ -f "$ENV_EXAMPLE_PATH" ]; then
    cp "$ENV_EXAMPLE_PATH" "$ENV_PATH"
    ok 'Copied .env.example -> .env'
  else
    printf 'VITE_CLERK_PUBLISHABLE_KEY=pk_test_ZmFpdGhmdWwtZ25hdC03NTY1LmNsZXJrLmFjY291bnRzLmRldiQ\n' > "$ENV_PATH"
    ok 'Created .env with the provided Clerk publishable key'
  fi
else
  ok '.env already exists, leaving it alone'
fi

step '4) Start the dev server'
echo '    The app will serve on http://localhost:5000 by default.' >&2
exec npm run dev
