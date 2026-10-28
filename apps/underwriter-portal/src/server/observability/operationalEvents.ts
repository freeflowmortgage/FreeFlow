export type OperationalEvent =
  | 'auth_denied'
  | 'scoped_object_denied'
  | 'stale_provenance_rejected'
  | 'document_pull_failure'
  | 'document_pull_retry'
  | 'document_pull_success'
  | 'sync_failure'
  | 'sync_retry'
  | 'sync_reconciliation'
  | 'webhook_delivery_success'
  | 'webhook_delivery_retry'
  | 'webhook_delivery_failure';

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,99}$/;

/**
 * Emit only bounded operational labels. Identifiers, request bodies, document
 * content, and provider responses must never be passed to this function.
 */
export function emitOperationalEvent(
  event: OperationalEvent,
  code?: string,
  status?: number,
): void {
  const record: { source: 'freeflow'; event: OperationalEvent; code?: string; status?: number } = {
    source: 'freeflow',
    event,
  };
  if (code) record.code = SAFE_CODE.test(code) ? code : 'UNSAFE_CODE_REDACTED';
  if (Number.isInteger(status) && status! >= 100 && status! <= 599) record.status = status;
  console.info(JSON.stringify(record));
}
