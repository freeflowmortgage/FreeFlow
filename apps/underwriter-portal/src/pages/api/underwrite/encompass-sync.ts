import type { NextApiRequest, NextApiResponse } from 'next';
import { withRequestContext, type RequestContext } from '../../../server/auth/requestContext';

/**
 * Legacy route retained as an explicit compatibility failure.
 *
 * Direct browser-driven writes accepted spoofable roles and caller-supplied
 * calculation payloads. The replacement will enqueue an immutable approved
 * calculation ID through the P0-08 sync worker.
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
      code: 'APPROVED_SYNC_WORKER_REQUIRED',
      message: 'Direct Encompass synchronization is disabled until the approved queue worker is available.',
      requestId: context.requestId,
    },
  });
}

export default withRequestContext('encompass:sync', handler);
