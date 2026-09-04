import type { NextApiRequest, NextApiResponse } from 'next';

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
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const tenantId = req.headers['x-tenant-id'] as string | undefined;
  const underwriterId = req.headers['x-underwriter-id'] as string | undefined;
  if (!tenantId || !underwriterId) {
    return res.status(401).json({ error: 'Missing tenant configuration or agent headers' });
  }

  try {
    const body = await collectBody(req);
    const headers: Record<string, string> = {
      'Content-Type': (req.headers['content-type'] as string) || 'application/pdf',
      'x-tenant-id': tenantId,
      'x-underwriter-id': underwriterId,
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
    const message = error instanceof Error ? error.message : String(error);
    return res.status(502).json({
      error: 'Live parser is unreachable. Start freeflow-doc-parser on :8080.',
      detail: message,
    });
  }
}

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
