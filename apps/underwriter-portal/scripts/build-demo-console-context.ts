/**
 * Builds the console context the public income demo loads in place of a
 * signed-in loan.
 *
 *   python services/doc-parser/scripts/snapshot_demo_packet.py
 *   pnpm --filter underwriter-portal exec tsx scripts/build-demo-console-context.ts
 *
 * Each parser snapshot goes through selectPersistableParserExtraction, the
 * projection a live upload is stored as, and every entity it yields is
 * assigned to the borrower named in the manifest, as a completed borrower
 * review would. The console then rehydrates this exactly as it rehydrates a
 * live loan, so the demo cannot show a field the live tool would drop.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { selectPersistableParserExtraction } from '../src/server/integrations/encompass/persistedParserExtraction';

type ManifestDocument = { attachmentId: string; fileName: string; category: string; borrowerKey: string };
type Manifest = {
  loan: { id: string; program: string; borrowerName: string };
  borrowers: { borrowerKey: string; role: 'PRIMARY' | 'CO_BORROWER' }[];
  documents: ManifestDocument[];
};

const consoleRoot = resolve(__dirname, '../../underwriting-console');
const packet = join(consoleRoot, 'demo-packet');
const manifest = JSON.parse(readFileSync(join(packet, 'manifest.json'), 'utf8')) as Manifest;

const attachments = [];
const extractions = [];
for (const document of manifest.documents) {
  const parsed = JSON.parse(readFileSync(join(packet, 'parse', `${document.attachmentId}.json`), 'utf8')) as Record<string, unknown>;
  const projection = selectPersistableParserExtraction(parsed);
  const input = projection.normalizedInput as { w2Records?: { entityId: string }[]; formRecords?: { entityId: string }[] };
  const entityIds = [...(input.w2Records ?? []), ...(input.formRecords ?? [])].map((row) => row.entityId);
  attachments.push({
    attachmentId: document.attachmentId,
    category: document.category,
    version: 1,
    pageCount: Number(parsed.total_pages_scanned) || 1,
    parserVersion: 'demo-snapshot',
  });
  extractions.push({
    id: `extraction-${document.attachmentId}`,
    attachmentId: document.attachmentId,
    sourceDocumentVersion: 1,
    parserVersion: 'demo-snapshot',
    schemaVersion: projection.schemaVersion,
    status: 'ACTIVE',
    warnings: projection.warnings,
    confidence: null,
    normalizedInput: projection.normalizedInput,
    evidence: projection.evidence,
    metadataReview: {
      id: `review-${document.attachmentId}`,
      metadataVersion: 1,
      assignments: entityIds.map((entityId) => ({ entityId, borrowerKey: document.borrowerKey })),
      current: true,
    },
  });
  console.log(`${document.fileName}: ${entityIds.length} entities, warnings ${projection.warnings.join(', ') || 'none'}`);
}

const output = {
  documents: manifest.documents.map(({ attachmentId, fileName }) => ({ attachmentId, fileName })),
  context: {
    loan: { id: manifest.loan.id, version: 1, status: 'ACTIVE', program: manifest.loan.program, borrowerName: manifest.loan.borrowerName },
    borrowers: manifest.borrowers,
    attachments,
    extractions,
    calculation: null,
    approval: null,
    hostWrite: null,
  },
};
const target = join(consoleRoot, 'public', 'demo-documents', 'console-context.json');
writeFileSync(target, `${JSON.stringify(output, null, 1)}\n`);
console.log(`wrote ${target}`);
