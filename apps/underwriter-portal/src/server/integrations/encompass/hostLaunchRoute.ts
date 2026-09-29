import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';

const GUID = /^[A-Za-z0-9-]{1,255}$/;

export function createHostLaunchHandler(dependencies = { withTenantTransaction }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', requestId: context.requestId } });
    try {
      const encompassLoanGuid = typeof req.body?.encompassLoanGuid === 'string' ? req.body.encompassLoanGuid.trim() : '';
      if (!GUID.test(encompassLoanGuid)) throw new ApiError(400, 'INVALID_ENCOMPASS_LOAN_GUID', 'The active Encompass loan identifier is invalid.');
      const result = await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, async (tx) => {
        const config = await tx.tenantConfiguration.findFirst({ where: { tenantId: context.tenantId }, select: { encompassIntegrationMode: true } });
        if (config?.encompassIntegrationMode !== 'ENCOMPASS_HOSTED') throw new ApiError(409, 'ENCOMPASS_HOSTED_NOT_ENABLED', 'Hosted Encompass integration is not enabled for this tenant.');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${encompassLoanGuid}`}, 2))`;
        const existing = await tx.loanApplication.findFirst({ where: { tenantId: context.tenantId, encompassGuid: encompassLoanGuid }, select: { id: true, version: true, encompassIntegrationMode: true } });
        if (existing?.encompassIntegrationMode === 'CUSTOM_CONNECTOR') throw new ApiError(409, 'ENCOMPASS_BINDING_MODE_CONFLICT', 'The loan is already bound through a different Encompass integration mode.');
        if (existing) {
          if (existing.encompassIntegrationMode === 'NONE') await tx.loanApplication.updateMany({
            where: { id: existing.id, tenantId: context.tenantId, encompassIntegrationMode: 'NONE' },
            data: { encompassIntegrationMode: 'ENCOMPASS_HOSTED' },
          });
          return { id: existing.id, version: existing.version, created: false };
        }
        const created = await tx.loanApplication.create({
          data: { tenantId: context.tenantId, encompassGuid: encompassLoanGuid, encompassIntegrationMode: 'ENCOMPASS_HOSTED' },
          select: { id: true, version: true },
        });
        return { ...created, created: true };
      });
      return res.status(200).json({ loanId: result.id, loanVersion: result.version, integrationMode: 'ENCOMPASS_HOSTED', created: result.created, requestId: context.requestId });
    } catch (error) { if (error instanceof ApiError) return sendApiError(res, context.requestId, error); throw error; }
  };
}
