import type { IncomingMessage, ServerResponse } from 'http';
import type { Connect } from 'vite';
import { randomUUID } from 'crypto';

/**
 * ZDR client-delivery relay for the AI 1003.
 *
 * Receives the MISMO 3.4 XML in memory and hands it to the client's LOS API
 * (stubbed here). Nothing is written to disk and nothing is retained after the
 * response is sent — the request body lives only for the lifetime of this
 * handler, which is what keeps the zero-data-retention guarantee intact.
 */
export function intakeDeliverMiddleware(): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = (req.url || '').split('?')[0];

    // Early partial-lead relay: fired once the borrower has given contact info,
    // so the client's CRM gets the lead even if the application is abandoned
    // midstream. JSON in, receipt out — relayed, never persisted (ZDR).
    if (path === '/api/intake/lead') {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Allow', 'POST');
        res.end();
        return;
      }
      const leadChunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => leadChunks.push(chunk));
      req.on('end', () => {
        try {
          const lead = JSON.parse(Buffer.concat(leadChunks).toString('utf8')) as Record<string, unknown>;
          if (!lead.borrowerName || (!lead.email && !lead.phone)) {
            res.statusCode = 422;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Lead requires a name and at least one contact point' }));
            return;
          }
          // Client CRM/LOS lead-webhook handoff happens here — relay only.
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              leadId: randomUUID(),
              deliveredTo: 'client-crm-lead-api',
              status: lead.status ?? 'IN_PROGRESS',
              receivedAt: new Date().toISOString(),
              retention: 'zero-data-retention-relay',
            }),
          );
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid JSON lead payload' }));
        }
      });
      return;
    }

    if (path !== '/api/intake/deliver') {
      next();
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 5 * 1024 * 1024) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const looksLikeMismo = body.trimStart().startsWith('<?xml') && body.includes('MISMOReferenceModelIdentifier');
      if (!looksLikeMismo) {
        res.statusCode = 422;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Expected a MISMO 3.4 XML payload' }));
        return;
      }

      // Client LOS API handoff happens here (Encompass / lender webhook).
      // The payload is relayed and immediately released — never persisted.
      const receipt = {
        receiptId: randomUUID(),
        deliveredTo: 'client-los-api',
        format: 'MISMO_3_4_XML',
        bytes,
        receivedAt: new Date().toISOString(),
        retention: 'zero-data-retention-relay',
      };

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(receipt));
    });
  };
}
