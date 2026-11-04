#!/usr/bin/env node
/**
 * Stops everything scripts/fusion/start.mjs launched, on any platform.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const pidFile = join(root, '.tmp', 'fusion-pids.json');
const isWindows = process.platform === 'win32';

/** Windows only exposes netstat/taskkill through a shell. */
function spawnSafe(command, args = [], options = {}) {
  if (isWindows) {
    const line = [command, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ');
    return spawnSync(line, { ...options, shell: true });
  }
  return spawnSync(command, args, options);
}

function freePort(port) {
  if (isWindows) {
    const netstat = spawnSafe('netstat', ['-ano'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of (netstat.stdout ?? '').split(/\r?\n/)) {
      if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      spawnSafe('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
    }
    return;
  }
  const lsof = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
  for (const pid of (lsof.stdout ?? '').split(/\s+/).filter(Boolean)) {
    spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
  }
}

if (existsSync(pidFile)) {
  try {
    const saved = JSON.parse(readFileSync(pidFile, 'utf8'));
    for (const pid of Object.values(saved)) {
      if (!pid) continue;
      if (isWindows) {
        spawnSafe('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      } else {
        spawnSync('kill', ['-9', String(pid)], { stdio: 'ignore' });
      }
    }
  } catch {
    /* unreadable state file: fall through to port cleanup */
  }
  rmSync(pidFile, { force: true });
}

for (const port of [8002, 5002, 5174]) freePort(port);

console.log('EchoLabs stopped.');
