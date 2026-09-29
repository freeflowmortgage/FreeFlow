export class PortalApiError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) {
    super(message);
  }
}

type RequestOptions = Readonly<{ method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string }>;

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    throw new PortalApiError(response.status, payload.error?.code ?? 'PORTAL_API_REQUEST_FAILED', payload.error?.message);
  }
  return response.json() as Promise<T>;
}

export const portalClient = {
  launchEncompassHost: (encompassLoanGuid: string, borrowers?: readonly { borrowerKey: string; role: 'PRIMARY' | 'CO_BORROWER' }[]) => request<{ loanId: string; loanVersion: number; borrowers?: readonly { borrowerKey: string; ordinal: number; role: string }[] }>('/api/v1/encompass-host/launch', { method: 'POST', body: borrowers?.length ? { encompassLoanGuid, borrowers } : { encompassLoanGuid } }),
  authorizeHostWrite: (loanId: string, body: { approvalEventId: string; expectedLoanVersion: number }, idempotencyKey: string) =>
    request<{ writeId: string; encompassLoanGuid: string; fieldMapHash: string; fields: Record<string, string>; status: 'AUTHORIZED' | 'SUCCEEDED' }>(`/api/v1/loans/${encodeURIComponent(loanId)}/encompass-host-approval-field-map`, { method: 'POST', body, idempotencyKey }),
  completeHostWrite: (writeId: string, body: { fieldMapHash: string; outcome: 'SUCCEEDED' | 'FAILED' }, idempotencyKey: string) =>
    request<{ writeId: string; status: 'SUCCEEDED' | 'FAILED' }>(`/api/v1/encompass-host-writes/${encodeURIComponent(writeId)}/complete`, { method: 'POST', body, idempotencyKey }),
  getConsoleContext: (loanId: string) => request(`/api/v1/loans/${encodeURIComponent(loanId)}/console-context`),
  getEncompassAttachments: (loanId: string) => request<{ source: 'ENCOMPASS'; attachments: Array<{ id: string; status: 'SELECTABLE' }> }>(`/api/v1/loans/${encodeURIComponent(loanId)}/encompass-attachments`),
  getMetadataRequirements: (loanId: string, extractionId: string) => request<{ extractionId: string; status: string; review: { metadataVersion: number; assignments: unknown; current: boolean } | null; requirements: Array<{ extractionId: string; entityId: string; field: 'taxYear' | 'employmentRole' | 'ownershipPercentage' | 'requiredParserField' | 'unsupportedCalculation' | 'borrowerAssignment' | 'assetElection' | 'elapsedMonths' | 'payFrequency' | 'baseIncomeMethod'; form: string }> }>(`/api/v1/loans/${encodeURIComponent(loanId)}/income-extractions/${encodeURIComponent(extractionId)}/metadata-requirements`),
  uploadIncomeDocument: (loanId: string, file: File) => fetch(`/api/v1/loans/${encodeURIComponent(loanId)}/income-documents`, {
    method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/pdf' }, body: file,
  }).then(async (response) => {
    if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } }; throw new PortalApiError(response.status, payload.error?.code ?? 'PORTAL_API_REQUEST_FAILED', payload.error?.message); }
    return response.json() as Promise<{ source: 'UPLOAD'; attachmentId: string; status: string }>;
  }),
  createDocumentPull: (loanId: string, body: { expectedLoanVersion: number; attachmentIds: string[] }, idempotencyKey: string) =>
    request<{ jobId: string; status: string }>(`/api/v1/loans/${encodeURIComponent(loanId)}/encompass-document-pulls`, { method: 'POST', body, idempotencyKey }),
  getDocumentPull: (jobId: string) => request<{ id: string; status: string }>(`/api/v1/encompass-document-pulls/${encodeURIComponent(jobId)}`),
  submitMetadataReview: (loanId: string, extractionId: string, body: unknown, idempotencyKey: string) =>
    request(`/api/v1/loans/${encodeURIComponent(loanId)}/income-extractions/${encodeURIComponent(extractionId)}/metadata-reviews`, { method: 'POST', body, idempotencyKey }),
  calculateIncome: (body: { loanId: string; extractionIds: string[] }) => request('/api/income/calculate', { method: 'POST', body }),
  approveIncome: (loanId: string, body: unknown, idempotencyKey: string) =>
    request(`/api/v1/loans/${encodeURIComponent(loanId)}/income-approvals`, { method: 'POST', body, idempotencyKey }),
  createSync: (loanId: string, body: unknown, idempotencyKey: string) =>
    request<{ jobId: string; status: string }>(`/api/v1/loans/${encodeURIComponent(loanId)}/encompass-syncs`, { method: 'POST', body, idempotencyKey }),
  getSync: (jobId: string) => request<{ id: string; status: string }>(`/api/v1/encompass-syncs/${encodeURIComponent(jobId)}`),
};
