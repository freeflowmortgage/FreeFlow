import type { NextApiRequest, NextApiResponse } from 'next';
import { isProtectedRuntime } from '../../../server/runtimeMode';
import { withRequestContext, type RequestContext } from '../../../server/auth/requestContext';
import { withTenantTransaction } from '../../../server/database/client';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const LOCAL_PARSER_URL = 'http://127.0.0.1:8080/api/underwrite/process';

/**
 * Portal ingest gateway: forwards PDF bytes to the live FastAPI parser.
 * Does not write uploads to disk and does not exec ai_pdf_converter-v2.py.
 */
async function handler(req: NextApiRequest, res: NextApiResponse, context: RequestContext) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST is supported.',
        requestId: context.requestId,
      },
    });
  }

  try {
    const parserUrl = resolveParserUrl();
    const body = await collectBody(req);
    const headers: Record<string, string> = {
      'Content-Type': (req.headers['content-type'] as string) || 'application/pdf',
      'x-tenant-id': context.tenantId,
      'x-underwriter-id': context.membershipId,
    };
    const loanId = req.headers['x-loan-id'];
    const loanProgram = req.headers['x-loan-program'];
    if (typeof loanId === 'string') {
      await requireTenantLoanAccess(loanId, context);
      headers['x-loan-id'] = loanId;
    } else if (isProtectedRuntime()) {
      throw new TenantLoanAccessError(400, 'LOAN_ID_REQUIRED', 'A loan identifier is required.');
    }
    if (typeof loanProgram === 'string') headers['x-loan-program'] = loanProgram;

    const upstream = await fetch(parserUrl, {
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
    const status = error instanceof TenantLoanAccessError
      ? error.status
      : error instanceof RequestTooLargeError ? 413 : 503;
    const code = error instanceof ParserConfigurationError
      ? 'DOCUMENT_PROCESSOR_UNAVAILABLE'
      : error instanceof TenantLoanAccessError
        ? error.code
      : error instanceof RequestTooLargeError
        ? 'PAYLOAD_TOO_LARGE'
        : 'DOCUMENT_PROCESSOR_UNAVAILABLE';
    const message = error instanceof TenantLoanAccessError
      ? error.publicMessage
      : error instanceof RequestTooLargeError
      ? 'Document exceeds the allowed size.'
      : 'Document processing is temporarily unavailable.';
    return res.status(status).json({
      error: {
        code,
        message,
        requestId: context.requestId,
      },
    });
  }
}

export default withRequestContext('income:process', handler);

export class TenantLoanAccessError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: 'LOAN_ID_REQUIRED' | 'LOAN_NOT_FOUND',
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = 'TenantLoanAccessError';
  }
}

export async function requireTenantLoanAccess(
  loanId: string,
  context: RequestContext,
  lookup: (loanId: string, context: RequestContext) => Promise<boolean> = tenantOwnsLoan,
): Promise<void> {
  if (!loanId.trim()) {
    throw new TenantLoanAccessError(400, 'LOAN_ID_REQUIRED', 'A loan identifier is required.');
  }
  if (!isProtectedRuntime() || await lookup(loanId, context)) return;
  // Deliberately indistinguishable for absent and cross-tenant records.
  throw new TenantLoanAccessError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
}

async function tenantOwnsLoan(loanId: string, context: RequestContext): Promise<boolean> {
  const loan = await withTenantTransaction(
    { tenantId: context.tenantId, principalId: context.membershipId },
    (transaction) => transaction.loanApplication.findFirst({
      where: { id: loanId, tenantId: context.tenantId },
      select: { id: true },
    }),
  );
  return loan !== null;
}

export function resolveParserUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PARSER_ENABLED?.trim().toLowerCase() === 'false') {
    throw new ParserConfigurationError();
  }
  const configured = env.DOC_PARSER_URL?.trim();
  if (!configured) {
    if (isProtectedRuntime(env)) {
      throw new ParserConfigurationError();
    }
    return LOCAL_PARSER_URL;
  }

  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    if (isProtectedRuntime(env) && ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('loopback dependency');
    }
    return parsed.toString();
  } catch {
    throw new ParserConfigurationError();
  }
}

function collectBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer | string) => {
      if (rejected) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > MAX_DOCUMENT_BYTES) {
        rejected = true;
        reject(new RequestTooLargeError());
        req.resume();
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

class ParserConfigurationError extends Error {
  constructor() {
    super('Parser configuration is unavailable.');
    this.name = 'ParserConfigurationError';
  }
}

class RequestTooLargeError extends Error {
  constructor() {
    super('Document exceeds the allowed size.');
    this.name = 'RequestTooLargeError';
  }
}
