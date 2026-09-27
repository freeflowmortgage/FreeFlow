import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

if (process.env.FREEFLOW_RUNTIME_MODE !== 'protected') {
  throw new Error('FREEFLOW_CONSOLE_PROTECTED_RUNTIME_REQUIRED');
}

const root = resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT || 3000);
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };

function safePath(pathname) {
  const candidate = resolve(root, `.${normalize(pathname)}`);
  return candidate.startsWith(`${root}\\`) || candidate === root ? candidate : null;
}

createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"HEALTHY","service":"freeflow-underwriting-console"}');
    return;
  }
  if (pathname.startsWith('/fixtures/') || pathname === '/parse' || pathname === '/api/underwrite/process') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":{"code":"CONSOLE_ROUTE_DISABLED"}}');
    return;
  }
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":{"code":"API_ROUTE_NOT_SERVED_BY_CONSOLE"}}');
    return;
  }
  let file = safePath(pathname === '/' ? '/index.html' : pathname);
  if (!file || !existsSync(file) || !(await stat(file)).isFile()) file = join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0');
