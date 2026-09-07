import type { NextApiRequest, NextApiResponse } from 'next';
import { withRequestContext, type RequestContext } from '../../../server/auth/requestContext';

/**
 * Deliberate compatibility failure.
 *
 * The former route used a Supabase service-role connection, caller-provided loan
 * identity, and direct Encompass document downloads. It must not be revived as
 * a Pages API route. P0-08 replaces it with a tenant-scoped, queue-driven
 * integration that reads immutable approval/source references only.
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

  res.setHeader('Retry-After', '3600');
  return res.status(503).json({
    error: {
      code: 'APPROVED_DOCUMENT_WORKER_REQUIRED',
      message: 'Direct document retrieval is disabled until the approved integration worker is available.',
      requestId: context.requestId,
    },
  });
}

export default withRequestContext('income:process', handler);
