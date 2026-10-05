import type { IncomingMessage, ServerResponse } from 'http';
import type { Connect } from 'vite';
import { generateDemoFixtureDocument, isSyntheticDemoDocumentPath } from './demoFixtureDocuments';

/** Serves an allowlisted synthetic comparison PDF. Returns false when the request is not one. */
export function handleSyntheticDemoDocument(req: IncomingMessage, res: ServerResponse): boolean {
  const path = (req.url || '/').split('?')[0] || '/';
  if (req.method !== 'GET' || !isSyntheticDemoDocumentPath(path)) return false;
  const params = new URLSearchParams((req.url || '').split('?')[1] ?? '');
  void generateDemoFixtureDocument(path, params)
    .then((document) => {
      if (!document) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end('{"detail":"Unknown demo document."}');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${document.kind}-demo.pdf"`);
      res.end(document.bytes);
    })
    .catch(() => {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"detail":"Demo document failed."}');
    });
  return true;
}

/** Vite adapter. Unknown paths fall through. */
export function demoDocumentMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!handleSyntheticDemoDocument(req, res)) next();
  };
}
