import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

export type ReceivedWebhook = Readonly<{ headers: Record<string, string | string[] | undefined>; body: string; path: string }>;

/**
 * Test-only HTTPS receiver with a throwaway self-signed certificate for
 * `localhost`. The certificate is added to this process's default trust store
 * so the production sender's normal TLS verification stays enabled.
 */
export async function startTestHttpsReceiver(responses: number[] = [204]): Promise<{
  url: (pathname?: string) => string;
  port: number;
  received: ReceivedWebhook[];
  respondWith: (statuses: number[]) => void;
  close: () => Promise<void>;
}> {
  const directory = mkdtempSync(path.join(tmpdir(), 'freeflow-webhook-receiver-'));
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost',
      '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'),
    ], { stdio: 'ignore' });
    const key = readFileSync(path.join(directory, 'key.pem'));
    const cert = readFileSync(path.join(directory, 'cert.pem'));
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), cert.toString('utf8')]);

    const received: ReceivedWebhook[] = [];
    let queue = [...responses];
    const server: Server = createServer({ key, cert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), path: req.url ?? '/' });
        const status = queue.length > 1 ? queue.shift()! : queue[0] ?? 204;
        if (status >= 300 && status < 400) res.setHeader('Location', 'https://localhost/elsewhere');
        res.statusCode = status;
        res.end(status === 204 ? undefined : 'receiver body that must never be stored');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      port,
      received,
      url: (pathname = '/freeflow/webhooks') => `https://localhost:${port}${pathname}`,
      respondWith: (statuses) => { queue = [...statuses]; },
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
