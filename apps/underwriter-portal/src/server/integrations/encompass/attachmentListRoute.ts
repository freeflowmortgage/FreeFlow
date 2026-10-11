import { CustomConnectorAdapter, EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';
import { isUuid } from '../../http/identifiers';
import { buildDocumentSelectionBindingHash } from './documentPullSelection';

type Dependencies = Readonly<{
  withTenantTransaction: typeof withTenantTransaction;
  list: (input: { tenantId: string; loanId: string; loanGuid: string; lenderId: string; deploymentId: string; correlationId: string }) => Promise<readonly { id: string }[]>;
}>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new EncompassConnectorError('CONNECTOR_CONFIGURATION_UNAVAILABLE', 'Connector configuration is unavailable.', false);
  return value;
}

const defaults: Dependencies = {
  withTenantTransaction,
  list: async (input) => new CustomConnectorAdapter({
    binding: { kind: 'custom', lenderId: input.lenderId, deploymentId: input.deploymentId, serviceBaseUrl: required('ENCOMPASS_CONNECTOR_SERVICE_URL') },
    serviceAuth: { kind: 'signed-hmac', serviceId: required('ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID'), signingKey: required('ENCOMPASS_CONNECTOR_SIGNING_KEY') },
  }).listActiveAttachments({ tenantId: input.tenantId, loanId: input.loanId, correlationId: input.correlationId }, input.loanGuid),
};

/** Browser-safe projection of the separately deployed connector's active attachments. */
export function createAttachmentListHandler(dependencies: Dependencies = defaults) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'GET') { res.setHeader('Allow', ['GET']); return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.', requestId: context.requestId } }); }
    try {
      const loanId = typeof req.query.loanId === 'string' && isUuid(req.query.loanId) ? req.query.loanId : null;
      if (!loanId) throw new ApiError(400, 'INVALID_IDENTIFIER', 'The loanId is not a valid identifier.');
      const record = await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, (transaction) => transaction.loanApplication.findFirst({
        where: { id: loanId, tenantId: context.tenantId },
        select: { id: true, encompassGuid: true, encompassIntegrationMode: true, tenant: { select: {
          configurations: { select: { enableEncompassDocumentPull: true } },
          encompassConnectorBinding: { select: { lenderId: true, deploymentId: true, isEnabled: true } },
        } } },
      }));
      if (!record) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
      if (record.encompassIntegrationMode !== 'CUSTOM_CONNECTOR') throw new ApiError(422, 'ENCOMPASS_CUSTOM_CONNECTOR_REQUIRED', 'The loan is not authorized for custom connector document retrieval.');
      if (!record.tenant.configurations?.enableEncompassDocumentPull) throw new ApiError(422, 'ENCOMPASS_DOCUMENT_PULL_DISABLED', 'Encompass document pull is not enabled for this tenant.');
      const binding = record.tenant.encompassConnectorBinding;
      if (!record.encompassGuid || !binding?.isEnabled) return res.status(422).json({ error: { code: 'ENCOMPASS_CONFIGURATION_INCOMPLETE', message: 'Authorized Encompass attachments are unavailable for this loan.', requestId: context.requestId } });
      let selectionBindingHash: string;
      try {
        selectionBindingHash = buildDocumentSelectionBindingHash({
          tenantId: context.tenantId,
          loanId,
          target: {
            integrationMode: 'CUSTOM_CONNECTOR',
            lenderId: binding.lenderId,
            deploymentId: binding.deploymentId,
            encompassLoanGuid: record.encompassGuid,
          },
        });
      } catch {
        throw new ApiError(422, 'ENCOMPASS_CONFIGURATION_INCOMPLETE', 'Authorized Encompass attachments are unavailable for this loan.');
      }
      const attachments = await dependencies.list({ tenantId: context.tenantId, loanId, loanGuid: record.encompassGuid, lenderId: binding.lenderId, deploymentId: binding.deploymentId, correlationId: context.requestId });
      return res.status(200).json({ source: 'ENCOMPASS', selectionBindingHash, attachments: attachments.map(({ id }) => ({ id, status: 'SELECTABLE' })), requestId: context.requestId });
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      if (error instanceof EncompassConnectorError) return res.status(error.retryable ? 503 : 502).json({ error: { code: error.retryable ? 'CONNECTOR_UNAVAILABLE' : 'CONNECTOR_RESPONSE_INVALID', message: 'Authorized Encompass attachments are temporarily unavailable.', requestId: context.requestId } });
      throw error;
    }
  };
}
