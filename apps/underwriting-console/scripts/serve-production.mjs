import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

const runtimeMode = process.env.FREEFLOW_RUNTIME_MODE || '';
if (!['protected-web', 'encompass-hosted'].includes(runtimeMode)) {
  throw new Error('FREEFLOW_CONSOLE_PROTECTED_RUNTIME_REQUIRED');
}

const testHostRequested = process.env.ENCOMPASS_TEST_HOST_ENABLED === 'true';
const testHostQualification = process.env.FREEFLOW_RUNTIME_ENV === 'development'
  && process.env.ENCOMPASS_TEST_HOST_QUALIFICATION === 'true';
if (testHostRequested && (runtimeMode !== 'encompass-hosted' || !testHostQualification)) {
  throw new Error('ENCOMPASS_TEST_HOST_FORBIDDEN');
}
const testHostLoanGuid = testHostRequested ? process.env.ENCOMPASS_TEST_HOST_LOAN_GUID?.trim() : null;
if (testHostRequested && (!testHostLoanGuid || !/^[A-Za-z0-9-]{1,255}$/.test(testHostLoanGuid))) {
  throw new Error('ENCOMPASS_TEST_HOST_LOAN_GUID_INVALID');
}

const frameAncestors = runtimeMode === 'encompass-hosted'
  ? parseFrameAncestors(process.env.ENCOMPASS_FRAME_ANCESTORS)
  : "'none'";

const root = resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT || 3000);
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };

function safePath(pathname) {
  const candidate = resolve(root, `.${normalize(pathname)}`);
  const pathFromRoot = relative(root, candidate);
  return (!pathFromRoot || (!pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))) ? candidate : null;
}

function parseFrameAncestors(value) {
  const entries = (value || '').split(/\s+/).filter(Boolean);
  if (!entries.length || entries.some((entry) => !/^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(entry))) {
    throw new Error('ENCOMPASS_FRAME_ANCESTORS_INVALID');
  }
  return entries.join(' ');
}

createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', `default-src 'self'; connect-src 'self' blob:; worker-src 'self' blob:; img-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors ${frameAncestors}; form-action 'self'`);
  if (runtimeMode === 'protected-web') res.setHeader('X-Frame-Options', 'DENY');
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"HEALTHY","service":"freeflow-underwriting-console"}');
    return;
  }
  if (pathname === '/runtime-config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ testHost: { enabled: testHostRequested, loanGuid: testHostLoanGuid } }));
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
