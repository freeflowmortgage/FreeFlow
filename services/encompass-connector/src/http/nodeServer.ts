import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { handleConnectorRequest, type ConnectorServiceDependencies } from './handleRequest';

/**
 * Minimal Node HTTP adapter around the Fetch handler.
 * Skeleton only — no live ECS task definition or Terraform apply.
 */
export function startConnectorHttpServer(options: Readonly<{
  port: number;
  deps: ConnectorServiceDependencies;
}>): Server {
  const origin = `http://127.0.0.1:${options.port}`;
  const server = createServer((req, res) => {
    void incomingToRequest(req, origin)
      .then((request) => handleConnectorRequest(request, options.deps))
      .then((response) => writeFetchResponse(res, response))
      .catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ safeCode: 'CONNECTOR_REQUEST_INVALID' }));
        }
      });
  });
  server.listen(options.port);
  return server;
}

async function incomingToRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const url = new URL(req.url ?? '/', origin);
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const method = req.method ?? 'GET';
  return new Request(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
}

async function writeFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}
