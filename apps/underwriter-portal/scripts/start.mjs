import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProductionConfig } from './production-config.mjs';

assertProductionConfig(process.env);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const nextCli = path.resolve(scriptDirectory, '..', 'node_modules', 'next', 'dist', 'bin', 'next');
const port = process.env.PORT || '3001';
const child = spawn(process.execPath, [nextCli, 'start', '-p', port], {
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error(`Unable to start the Next.js server: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
