#!/usr/bin/env node
/**
 * EchoLabs launcher (Windows + macOS + Linux).
 *
 * Frees the EchoLabs ports, starts the ASR service, the API server and the Vite
 * dev server as hidden background processes, waits until the web port answers,
 * opens the browser once, then exits so the console can close itself.
 *
 * Stop everything with scripts/fusion/stop.mjs (stop_fusion.bat / .command).
 * Logs: .tmp/logs/{asr,api,web}.log
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const frontendDir = join(root, 'artifacts', 'fusion-coach');
const apiDir = join(root, 'artifacts', 'api-server');
const asrDir = join(root, 'artifacts', 'asr-service');
const tmpDir = join(root, '.tmp');
const logDir = join(tmpDir, 'logs');
const pidFile = join(tmpDir, 'fusion-pids.json');
const isWindows = process.platform === 'win32';

const PORTS = { asr: 8002, api: 5002, web: 5174 };
const WEB_URL = `http://localhost:${PORTS.web}`;

mkdirSync(logDir, { recursive: true });

/** Windows only exposes netstat/taskkill/.cmd shims through a shell. */
function spawnSafe(command, args = [], options = {}) {
  if (isWindows) {
    const line = [command, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ');
    return spawnSync(line, { ...options, shell: true });
  }
  return spawnSync(command, args, options);
}

function step(text) {
  console.log(text);
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

function killPrevious() {
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
  for (const port of Object.values(PORTS)) freePort(port);
}

function logStream(name) {
  const path = join(logDir, `${name}.log`);
  const fd = openSync(path, 'w');
  return { fd, close: () => closeSync(fd) };
}

function spawnHidden(name, cwd, command, args, env = {}) {
  const log = logStream(name);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', log.fd, log.fd],
    detached: true,
    windowsHide: true,
  });
  child.unref();
  log.close();
  step(`    started ${name.padEnd(4)} (pid ${child.pid})`);
  return child.pid;
}

function pythonCommand() {
  const venv = join(asrDir, '.venv', isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python');
  if (existsSync(venv)) return venv;
  const probe = spawnSafe(isWindows ? 'python' : 'python3', ['--version'], { stdio: 'ignore' });
  return probe.status === 0 ? (isWindows ? 'python' : 'python3') : null;
}

function viteBinary() {
  const candidates = [
    join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'),
    join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function waitForPort(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function openBrowser(url) {
  if (process.env.ECHOLABS_NO_BROWSER === '1') return;
  if (isWindows) {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', shell: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

step('EchoLabs - starting the local stack');

if (!existsSync(join(frontendDir, 'node_modules'))) {
  console.error('    Dependencies are not installed yet.');
  console.error(isWindows ? '    Run install.bat first, then start again.' : '    Run ./install.command first, then start again.');
  process.exit(1);
}

killPrevious();

const pids = { asr: null, api: null, web: null };

const python = pythonCommand();
if (python) {
  pids.asr = spawnHidden('asr', asrDir, python, ['app.py'], { ASR_PORT: String(PORTS.asr) });
} else {
  step('    skipped asr (Python not found; run the installer to enable transcription)');
}

if (existsSync(join(apiDir, 'dist', 'index.mjs'))) {
  pids.api = spawnHidden('api', apiDir, process.execPath, ['--enable-source-maps', './dist/index.mjs'], {
    PORT: String(PORTS.api),
    ASR_SERVICE_URL: `http://127.0.0.1:${PORTS.asr}`,
  });
} else {
  step('    skipped api (run the installer to build it)');
}

const vite = viteBinary();
if (vite) {
  pids.web = spawnHidden(
    'web',
    frontendDir,
    process.execPath,
    [vite, '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(PORTS.web), '--strictPort'],
    { API_PROXY_TARGET: `http://127.0.0.1:${PORTS.api}` },
  );
} else {
  pids.web = spawnHidden('web', frontendDir, 'npx', [
    '--yes',
    'vite',
    '--config',
    'vite.config.ts',
    '--host',
    '127.0.0.1',
    '--port',
    String(PORTS.web),
    '--strictPort',
  ], { API_PROXY_TARGET: `http://127.0.0.1:${PORTS.api}` });
}

writeFileSync(pidFile, JSON.stringify(pids, null, 2), 'utf8');

const ready = await waitForPort(PORTS.web);
if (ready) {
  step(`EchoLabs is live at ${WEB_URL}`);
  step(isWindows ? 'Stop it later with stop_fusion.bat' : 'Stop it later with ./stop_fusion.command');
  openBrowser(WEB_URL);
} else {
  console.error(`    The web server did not answer on port ${PORTS.web}. See .tmp/logs/web.log`);
  process.exitCode = 1;
}
