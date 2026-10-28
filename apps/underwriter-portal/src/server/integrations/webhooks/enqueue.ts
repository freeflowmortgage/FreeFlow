import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import { INCOME_APPROVED_EVENT } from './payload';

export const WEBHOOK_AUDIT_RULE_VERSION = 'outbound-webhook-v1';

/**
 * Commits an identifiers-only outbox row in the caller's approval transaction.
 * Only standalone loans are eligible; Encompass-linked loans keep their own
 * sync path and are never queued here.
 */
export async function enqueueApprovedIncomeWebhook(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{ loanId: string; approvalEventId: string; approvedLoanVersion: number }>,
): Promise<{ deliveryId: string } | null> {
  const loan = await transaction.loanApplication.findFirst({
    where: { id: input.loanId, tenantId: context.tenantId },
    select: { encompassIntegrationMode: true },
  });
  if (loan?.encompassIntegrationMode !== 'NONE') return null;

  const endpoint = await transaction.outboundWebhookEndpoint.findFirst({
    where: { tenantId: context.tenantId, isEnabled: true },
    select: { id: true },
  });
  if (!endpoint) return null;

  const delivery = await transaction.outboundWebhookDelivery.create({
    data: {
      tenantId: context.tenantId,
      loanId: input.loanId,
      endpointId: endpoint.id,
      approvalEventId: input.approvalEventId,
      requestedByUserId: context.membershipId,
      eventType: INCOME_APPROVED_EVENT,
      approvedLoanVersion: input.approvedLoanVersion,
      correlationId: context.requestId,
    },
    select: { id: true },
  });
  await appendAuditEvent(transaction, context, {
    loanId: input.loanId,
    entityType: 'OUTBOUND_WEBHOOK_DELIVERY',
    entityId: delivery.id,
    expectedLoanVersion: input.approvedLoanVersion + 1,
    action: AUDIT_ACTIONS.OUTBOUND_WEBHOOK_QUEUED,
    reasonCode: 'APPROVED_RESULT_QUEUED',
    ruleVersion: WEBHOOK_AUDIT_RULE_VERSION,
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      approvalEventId: input.approvalEventId,
      eventType: INCOME_APPROVED_EVENT,
    }),
  });
  return { deliveryId: delivery.id };
}
