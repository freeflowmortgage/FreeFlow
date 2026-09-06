import type { NextApiRequest, NextApiResponse } from 'next';
import { withRequestContext, type RequestContext } from '../../../server/auth/requestContext';

export const config = {
  api: {
    bodyParser: false,
  },
};

const PARSER_URL = process.env.DOC_PARSER_URL || 'http://127.0.0.1:8080/api/underwrite/process';

/**
 * Portal ingest gateway: forwards PDF bytes to the live FastAPI parser.
 * Does not write uploads to disk and does not exec ai_pdf_converter-v2.py.
 */
async function handler(req: NextApiRequest, res: NextApiResponse, context: RequestContext) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = await collectBody(req);
    const headers: Record<string, string> = {
      'Content-Type': (req.headers['content-type'] as string) || 'application/pdf',
      'x-tenant-id': context.tenantId,
      'x-underwriter-id': context.membershipId,
    };
    const loanId = req.headers['x-loan-id'];
    const loanProgram = req.headers['x-loan-program'];
    if (typeof loanId === 'string') headers['x-loan-id'] = loanId;
    if (typeof loanProgram === 'string') headers['x-loan-program'] = loanProgram;

    const upstream = await fetch(PARSER_URL, {
      method: 'POST',
      headers,
      body: new Uint8Array(body),
    });
    const json = await upstream.json();
    return res.status(upstream.status).json(json);
  } catch (error: unknown) {
    console.error('[underwrite-process] parser request failed', {
      requestId: context.requestId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return res.status(502).json({
      error: {
        code: 'DOCUMENT_PROCESSOR_UNAVAILABLE',
        message: 'Document processing is temporarily unavailable.',
        requestId: context.requestId,
      },
    });
  }
}

export default withRequestContext('income:process', handler);

function collectBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
