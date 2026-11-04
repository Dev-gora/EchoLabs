#!/usr/bin/env node
/**
 * EchoLabs one-click installer (Windows + macOS + Linux).
 *
 * Installs everything the app needs on a fresh machine:
 *   1. Node dependencies for the workspace (pnpm, npm fallback)
 *   2. artifacts/fusion-coach/.env from .env.example
 *   3. a build of the Express API server
 *   4. Python transcription dependencies (optional, never fatal)
 *
 * Usage:  node scripts/fusion/install.mjs [--force] [--skip-python]
 * Then:   node scripts/fusion/start.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const frontendDir = join(root, 'artifacts', 'fusion-coach');
const apiDir = join(root, 'artifacts', 'api-server');
const asrDir = join(root, 'artifacts', 'asr-service');
const venvDir = join(asrDir, '.venv');
const isWindows = process.platform === 'win32';
const force = process.argv.includes('--force');
const skipPython = process.argv.includes('--skip-python');

const PUBLIC_CLERK_KEY =
  'pk_test_ZmFpdGhmdWwtZ25hdC03NTY1LmNsZXJrLmFjY291bnRzLmRldiQ';

const ASR_IMPORTS = 'import fastapi, uvicorn, faster_whisper';

let failures = 0;

const heading = (text) => console.log(`\n==> ${text}`);
const ok = (text) => console.log(`    OK: ${text}`);
const note = (text) => console.log(`    ${text}`);
const skipped = (text) => console.log(`    SKIPPED: ${text}`);

function venvPython() {
  return join(venvDir, isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python');
}

/** Windows runs .cmd shims (npx, npm, py) only through a shell, so pass one line. */
function spawnSafe(command, args = [], options = {}) {
  if (isWindows) {
    const line = [command, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ');
    return spawnSync(line, { ...options, shell: true });
  }
  return spawnSync(command, args, options);
}

/** Runs a command with a hard time limit so a stuck install can never hang. */
function run(command, args, options = {}) {
  const result = spawnSafe(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.quiet ? 'ignore' : 'inherit',
    timeout: options.timeoutMs ?? 600_000,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    note(`timed out: ${command} ${args.join(' ')}`);
    return false;
  }
  return result.status === 0;
}

function probe(command, args) {
  const result = spawnSafe(command, args, { stdio: 'ignore', timeout: 30_000 });
  return result.status === 0;
}

function pythonCandidates() {
  const list = [];
  if (existsSync(venvPython())) list.push({ command: venvPython(), args: [] });
  if (isWindows) {
    list.push({ command: 'py', args: ['-3'] }, { command: 'python', args: [] });
  } else {
    list.push({ command: 'python3', args: [] }, { command: 'python', args: [] });
  }
  return list;
}

heading('1) Node.js');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  console.error(`    FAIL: Node ${process.versions.node} is too old. Install Node 18+ from https://nodejs.org`);
  process.exit(1);
}
ok(`Node ${process.versions.node} on ${process.platform}/${process.arch}`);

heading('2) JavaScript dependencies');
if (!force && existsSync(join(frontendDir, 'node_modules'))) {
  ok('node_modules already present (pass --force to reinstall)');
} else {
  note('Installing workspace dependencies (a few minutes on first run)...');
  if (run('npx', ['--yes', 'pnpm@10', 'install', '--prefer-offline'], { timeoutMs: 900_000 })) {
    ok('workspace installed with pnpm');
  } else if (run('npm', ['install', '--no-audit', '--no-fund'], { cwd: frontendDir })) {
    ok('frontend installed with npm (pnpm unavailable)');
  } else {
    console.error('    FAIL: dependency install failed. Install pnpm (corepack enable) or npm and retry.');
    failures += 1;
  }
}

heading('3) Environment file');
const envPath = join(frontendDir, '.env');
const envExamplePath = join(frontendDir, '.env.example');
if (existsSync(envPath) && !force) {
  ok('.env already exists');
} else {
  let contents = '';
  if (existsSync(envExamplePath)) {
    contents = readFileSync(envExamplePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith('['))
      .join('\n');
  }
  if (!contents.includes('VITE_CLERK_PUBLISHABLE_KEY')) {
    contents += `\nVITE_CLERK_PUBLISHABLE_KEY=${PUBLIC_CLERK_KEY}`;
  }
  writeFileSync(envPath, `${contents.replace(/^\n+/, '')}\n`, 'utf8');
  ok('created artifacts/fusion-coach/.env with the public Clerk key');
}
note('Optional Supabase settings: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to that .env');

heading('4) API server build');
if (!force && existsSync(join(apiDir, 'dist', 'index.mjs'))) {
  ok('api-server already built');
} else if (run('node', ['build.mjs'], { cwd: apiDir })) {
  ok('api-server built into artifacts/api-server/dist');
} else {
  note('api-server build failed - the frontend still runs, /api calls will not resolve');
}

heading('5) Python transcription service (optional)');
if (skipPython) {
  skipped('--skip-python was passed');
} else {
  // An empty or half-built .venv left by an interrupted install would shadow a
  // perfectly good system Python, so drop it.
  if (existsSync(venvDir) && !existsSync(venvPython())) {
    rmSync(venvDir, { recursive: true, force: true });
  }

  const candidates = pythonCandidates();
  const ready = candidates.find((candidate) =>
    probe(candidate.command, [...candidate.args, '-c', ASR_IMPORTS]),
  );

  if (ready) {
    ok(`transcription dependencies already available (${ready.command})`);
  } else {
    const python = candidates.find((candidate) => probe(candidate.command, [...candidate.args, '--version']));
    if (!python) {
      skipped('Python 3.10+ not found. Install it to enable local transcription; the app still runs.');
    } else if (!existsSync(venvPython())) {
      note('Creating a virtualenv in artifacts/asr-service/.venv ...');
      run(python.command, [...python.args, '-m', 'venv', venvDir]);
    }

    if (existsSync(venvPython())) {
      note('Installing faster-whisper + acoustics wheels (several minutes on first run)...');
      const installed = run(
        venvPython(),
        ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements.txt'],
        { cwd: asrDir, timeoutMs: 900_000 },
      );
      if (installed) {
        ok('transcription service ready');
      } else {
        skipped('pip install did not finish; transcription stays off (the app still runs).');
        skipped('Retry with: cd artifacts/asr-service && python -m pip install -r requirements.txt');
      }
    }
  }
}

mkdirSync(join(root, '.tmp'), { recursive: true });

console.log('');
if (failures === 0) {
  console.log('Install complete. Start the app with:');
  console.log(isWindows ? '    start_fusion.bat  (double-click)' : '    ./start_fusion.command  (double-click)');
} else {
  console.log('Install finished with errors - see above.');
  process.exitCode = 1;
}
