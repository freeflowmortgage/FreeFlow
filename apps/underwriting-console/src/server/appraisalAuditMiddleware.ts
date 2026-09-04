import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

const DEFAULT_APPRAISAL_PARSER_URL = 'http://127.0.0.1:8081';
const AUDIT_PATH = '/api/appraisal/audit';
const SERVICE_PATH = '/api/v1/appraisal/audit';
const MAX_PROXY_BYTES = 15 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_PROXY_BYTES) throw new Error('APPRAISAL_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function serviceUrl(): string {
  const base = (process.env.APPRAISAL_PARSER_URL || DEFAULT_APPRAISAL_PARSER_URL).replace(/\/+$/, '');
  return base.endsWith(SERVICE_PATH) ? base : `${base}${SERVICE_PATH}`;
}

export function appraisalAuditMiddleware(): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = (req.url || '').split('?')[0];
    if (path !== AUDIT_PATH) {
      next();
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      res.end();
      return;
    }

    void (async () => {
      try {
        const body = await readBody(req);
        const headers = new Headers();
        for (const name of [
          'content-type',
          'x-tenant-id',
          'x-underwriter-id',
          'x-loan-id',
          'x-loan-program',
          'x-document-title',
          'x-appraisal-case-number',
        ]) {
          const value = req.headers[name];
          if (typeof value === 'string') headers.set(name, value);
        }

        const upstream = await fetch(serviceUrl(), {
          method: 'POST',
          headers,
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(30_000),
        });
        const payload = Buffer.from(await upstream.arrayBuffer());
        res.statusCode = upstream.status;
        for (const name of ['content-type', 'cache-control', 'pragma', 'x-appraisal-rule-version']) {
          const value = upstream.headers.get(name);
          if (value) res.setHeader(name, value);
        }
        res.end(payload);
      } catch (error) {
        if (error instanceof Error && error.message === 'APPRAISAL_TOO_LARGE') {
          sendJson(res, 413, { detail: 'PDF exceeds the 15 MB appraisal size limit.' });
          return;
        }
        sendJson(res, 502, {
          detail: 'Appraisal audit service is unavailable.',
        });
      }
    })();
  };
}
