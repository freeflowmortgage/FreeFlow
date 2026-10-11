import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const consoleDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const viteCli = path.join(consoleDirectory, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = path.join(consoleDirectory, 'node_modules', '@playwright', 'test', 'cli.js');
const baseUrl = 'http://127.0.0.1:3014';

const vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '3014'], {
  cwd: consoleDirectory,
  env: { ...process.env, VITE_FREEFLOW_RUNTIME_MODE: 'protected-web' },
  stdio: 'inherit',
});

let exitCode = 1;
try {
  await waitForServer(vite, baseUrl, 120_000);
  exitCode = await run(process.execPath, [
    playwrightCli,
    'test',
    '--config',
    'playwright.standalone.config.ts',
    ...process.argv.slice(2),
  ], {
    ...process.env,
    FREEFLOW_PLAYWRIGHT_EXTERNAL_SERVER: '1',
  });
} finally {
  await stop(vite);
}

process.exitCode = exitCode;

async function waitForServer(child, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`VITE_EXITED_BEFORE_READY_${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('VITE_START_TIMEOUT');
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: consoleDirectory, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function stop(child) {
  if (child.exitCode !== null || !child.pid) return;
  child.kill('SIGTERM');
  const closed = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (closed || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}
