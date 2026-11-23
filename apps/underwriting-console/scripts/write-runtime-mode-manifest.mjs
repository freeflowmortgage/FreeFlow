import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.env.VITE_FREEFLOW_RUNTIME_MODE || 'protected-web';
if (!['demo', 'qa', 'protected-web', 'encompass-hosted'].includes(mode)) {
  throw new Error('FREEFLOW_CONSOLE_MODE_INVALID');
}

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(appRoot, 'dist');
await mkdir(dist, { recursive: true });
await writeFile(resolve(dist, '.freeflow-runtime-mode'), `${mode}\n`, 'utf8');
