export class PortalApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
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
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string } };
    throw new PortalApiError(response.status, payload.error?.code ?? 'PORTAL_API_REQUEST_FAILED');
  }
  return response.json() as Promise<T>;
}

export const portalClient = {
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
