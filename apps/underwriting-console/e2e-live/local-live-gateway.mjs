import { createServer, request as httpRequest } from 'node:http';

const consoleOrigin = localOrigin('LIVE_CONSOLE_ORIGIN');
const portalOrigin = localOrigin('LIVE_PORTAL_ORIGIN');
const port = parsePort(process.env.PORT || '3014');

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  const upstream = requestUrl.pathname.startsWith('/api/') ? portalOrigin : consoleOrigin;
  const headers = { ...request.headers, host: upstream.host };
  delete headers.connection;
  delete headers['proxy-connection'];
  delete headers['keep-alive'];
  delete headers.upgrade;

  const proxyRequest = httpRequest(new URL(`${requestUrl.pathname}${requestUrl.search}`, upstream), {
    method: request.method,
    headers,
  }, (proxyResponse) => {
    const responseHeaders = { ...proxyResponse.headers };
    delete responseHeaders.connection;
    delete responseHeaders['keep-alive'];
    delete responseHeaders['transfer-encoding'];
    response.writeHead(proxyResponse.statusCode || 502, responseHeaders);
    proxyResponse.pipe(response);
  });

  proxyRequest.on('error', () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end('{"error":{"code":"LOCAL_LIVE_UPSTREAM_UNAVAILABLE"}}');
  });
  request.pipe(proxyRequest);
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({
    status: 'READY',
    scope: 'LOCAL_LIVE_GATEWAY',
    origin: `http://127.0.0.1:${port}`,
    consoleOrigin: consoleOrigin.origin,
    portalOrigin: portalOrigin.origin,
    businessApiMocked: false,
  }));
});

function localOrigin(name) {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} is required.`);
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error(`${name} must be an HTTP loopback origin.`);
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an origin only.`);
  }
  return parsed;
}

function parsePort(raw) {
  const candidate = Number(raw);
  if (!Number.isInteger(candidate) || candidate < 1024 || candidate > 65_535) {
    throw new Error('PORT must be an unprivileged TCP port.');
  }
  return candidate;
}
