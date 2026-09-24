import { randomUUID } from 'node:crypto';
import { CustomConnectorAdapter, createLenderConnectorBinding } from '@mortgage-pos/encompass-connector-contract';

type SmokeDependencies = Readonly<{
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  report?: (value: Record<string, unknown>) => void;
}>;

export async function runRealConnectorParserSmoke(dependencies: SmokeDependencies = {}): Promise<void> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetch ?? fetch;
  const report = dependencies.report ?? ((value) => console.log(JSON.stringify(value)));
  const tenantId = required(env, 'SMOKE_TENANT_ID');
  const lenderId = required(env, 'SMOKE_LENDER_ID');
  const deploymentId = required(env, 'SMOKE_DEPLOYMENT_ID');
  const loanGuid = required(env, 'SMOKE_LOAN_GUID');
  const adapter = new CustomConnectorAdapter({
    binding: createLenderConnectorBinding({ lenderId, deploymentId, serviceBaseUrl: required(env, 'CONNECTOR_SERVICE_BASE_URL') }),
    serviceAuth: { kind: 'signed-hmac', serviceId: required(env, 'SMOKE_SERVICE_ID'), signingKey: required(env, 'CONNECTOR_SIGNING_KEY') },
    fetch: fetchImpl,
  });
  const context = { tenantId, loanId: `smoke-${randomUUID()}`, correlationId: `smoke-${randomUUID()}` };
  const attachments = await adapter.listActiveAttachments(context, loanGuid);
  const attachmentId = env.SMOKE_ATTACHMENT_ID?.trim() || attachments[0]?.id;
  if (!attachmentId) throw new Error('No attachment was available for the supplied loan.');
  const downloaded = await adapter.downloadOriginalAttachment(context, loanGuid, attachmentId);
  try {
    const response = await fetchImpl(`${required(env, 'PARSER_SERVICE_BASE_URL')}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-document-name': 'connector-smoke.pdf' },
      body: downloaded.bytes,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Parser returned HTTP ${response.status}.`);
    const parsed = await response.json() as { page_count?: unknown; ocr_page_count?: unknown; classifications?: unknown };
    if (typeof parsed.page_count !== 'number' || typeof parsed.ocr_page_count !== 'number' || !parsed.classifications) {
      throw new Error('Parser response was not structured as expected.');
    }
    report({ marker: 'REAL_CONNECTOR_PARSER_SMOKE=passed', sha256: downloaded.sha256, pageCount: parsed.page_count, ocrPageCount: parsed.ocr_page_count, classifications: parsed.classifications });
  } finally {
    downloaded.bytes.fill(0);
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Required smoke configuration is missing: ${name}`);
  return value;
}

if (require.main === module) {
  runRealConnectorParserSmoke().catch((error: unknown) => {
    console.error('Real connector parser smoke failed.', { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
