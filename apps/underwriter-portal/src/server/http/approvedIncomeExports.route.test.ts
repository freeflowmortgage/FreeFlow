import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import {
  MISMO_APPROVED_INCOME_PROFILE,
  MISMO_OFFICIAL_XSD_VALIDATION_STATUS,
  approvedIncomeSummaryLines,
  renderApprovedIncomeSummaryPdf,
  serializeApprovedIncomeJson,
  serializeApprovedIncomeMismo,
  validateApprovedIncomeMismoProfile,
} from '../exports/approvedIncomeExports';
import { loadApprovedIncomeSnapshot } from '../exports/approvedIncomeSnapshot';
import { createApprovedIncomeExportHandler } from './approvedIncomeExportsRoute';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const CALCULATION = '00000000-0000-4000-8000-000000000300';
const APPROVAL = '00000000-0000-4000-8000-000000000400';
const APPROVED_AT = new Date('2026-10-11T08:30:00.000Z');
const context = {
  requestId: 'export-request-1',
  subject: 'synthetic-underwriter',
  tenantId: TENANT,
  membershipId: USER,
  permissions: ['loan:read'] as const,
  authTime: new Date('2026-10-11T08:00:00.000Z'),
} satisfies RequestContext;

test('assembles one deterministic current approved snapshot from tenant-scoped persisted facts', async () => {
  const tx = transaction();
  const first = await loadApprovedIncomeSnapshot(tx as never, context, LOAN);
  const second = await loadApprovedIncomeSnapshot(tx as never, context, LOAN);

  assert.deepEqual(first, second);
  assert.equal(first.loan.integrationMode, 'NONE');
  assert.equal(first.approval.eventId, APPROVAL);
  assert.equal(first.calculation.qualifyingMonthlyIncome, '8000.00');
  assert.deepEqual(first.calculation.borrowers, [{
    borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY', qualifyingMonthlyIncome: '8000.00',
  }]);
  assert.match(first.snapshotHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(tx.state.loanWhere, { id: LOAN, tenantId: TENANT });
  assert.deepEqual(tx.state.calculationWhere, {
    id: CALCULATION, tenantId: TENANT, loanId: LOAN, isHumanVerified: true,
  });
});

test('approved snapshot fails closed for a stale loan or cross-tenant lookup', async () => {
  const stale = transaction({ loanVersion: 5 });
  await assert.rejects(
    () => loadApprovedIncomeSnapshot(stale as never, context, LOAN),
    (error: unknown) => error instanceof Error && error.message === 'STALE_APPROVED_CALCULATION',
  );
  const missing = transaction({ loanMissing: true });
  await assert.rejects(
    () => loadApprovedIncomeSnapshot(missing as never, context, LOAN),
    (error: unknown) => error instanceof Error && error.message === 'LOAN_NOT_FOUND',
  );
  assert.equal(missing.state.calculationQueried, false);
});

test('JSON, MISMO profile, and PDF summary use the same snapshot values and hash', async () => {
  const snapshot = await loadApprovedIncomeSnapshot(transaction() as never, context, LOAN);
  const json = JSON.parse(serializeApprovedIncomeJson(snapshot));
  assert.equal(json.exportProfile, 'freeflow-approved-income-json-v1');
  assert.equal(json.snapshotHash, snapshot.snapshotHash);
  assert.equal(json.calculation.qualifyingMonthlyIncome, '8000.00');

  const xml = serializeApprovedIncomeMismo(snapshot);
  const validation = validateApprovedIncomeMismoProfile(xml, snapshot);
  assert.deepEqual(validation, {
    status: 'PASS',
    implementationProfile: MISMO_APPROVED_INCOME_PROFILE,
    referenceModelIdentifier: '3.4.0',
    officialXsdValidation: MISMO_OFFICIAL_XSD_VALIDATION_STATUS,
  });
  assert.match(xml, new RegExp(snapshot.snapshotHash));
  assert.match(xml, /<FREEFLOW:QualifyingMonthlyIncomeAmount>8000\.00<\/FREEFLOW:QualifyingMonthlyIncomeAmount>/);
  assert.match(xml, /NOT_PERFORMED_OFFICIAL_XSD_NOT_BUNDLED/);
  assert.throws(
    () => validateApprovedIncomeMismoProfile(xml.replace(snapshot.snapshotHash, 'missing'), snapshot),
    /MISMO_PROFILE_REQUIRED_VALUE_MISSING/,
  );
  assert.throws(
    () => validateApprovedIncomeMismoProfile(xml.replace('</MESSAGE>', '</BROKEN>'), snapshot),
    /MISMO_PROFILE_XML_NOT_WELL_FORMED/,
  );

  const lines = approvedIncomeSummaryLines(snapshot);
  assert.ok(lines.includes(`Snapshot: ${snapshot.snapshotHash}`));
  assert.ok(lines.includes('Qualifying monthly income: $8000.00'));
  const pdf = await renderApprovedIncomeSummaryPdf(snapshot);
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.byteLength > 1_000);
});

test('download handler returns bounded formats and honest MISMO validation headers', async () => {
  const tx = transaction();
  const handler = createApprovedIncomeExportHandler({
    withTenantTransaction: (async (scope, operation) => {
      assert.deepEqual(scope, { tenantId: TENANT, principalId: USER });
      return operation(tx as never);
    }) as never,
    renderPdf: async () => Buffer.from('%PDF-synthetic-summary'),
  });

  const json = response();
  await handler(request('json'), json.res, context);
  assert.equal(json.state.status, 200);
  assert.equal(json.state.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.match(String(json.state.headers['Content-Disposition']), /\.json"$/);
  const jsonBody = JSON.parse(String(json.state.body));
  assert.equal(json.state.headers['X-FreeFlow-Snapshot-Hash'], jsonBody.snapshotHash);

  const mismo = response();
  await handler(request('mismo'), mismo.res, context);
  assert.equal(mismo.state.status, 200);
  assert.equal(mismo.state.headers['X-FreeFlow-Export-Profile'], MISMO_APPROVED_INCOME_PROFILE);
  assert.equal(mismo.state.headers['X-MISMO-Official-XSD-Validation'], MISMO_OFFICIAL_XSD_VALIDATION_STATUS);

  const pdf = response();
  await handler(request('summary'), pdf.res, context);
  assert.equal(pdf.state.headers['Content-Type'], 'application/pdf');
  assert.equal((pdf.state.body as Buffer).toString('ascii'), '%PDF-synthetic-summary');

  const invalid = response();
  await handler(request('raw'), invalid.res, context);
  assert.equal(invalid.state.status, 404);
  assert.equal((invalid.state.body as { error: { code: string } }).error.code, 'EXPORT_FORMAT_NOT_FOUND');
});

function request(format: string) {
  return { method: 'GET', query: { loanId: LOAN, format } } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, unknown> } = { headers: {} };
  const res = {
    setHeader(name: string, value: unknown) { state.headers[name] = value; },
    status(code: number) { state.status = code; return res; },
    send(body: unknown) { state.body = body; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function transaction(options: { loanVersion?: number; loanMissing?: boolean } = {}) {
  const state: {
    loanWhere?: unknown;
    calculationWhere?: unknown;
    calculationQueried: boolean;
  } = { calculationQueried: false };
  const loan = {
    id: LOAN,
    version: options.loanVersion ?? 4,
    loanProgram: 'CONVENTIONAL',
    encompassIntegrationMode: 'NONE',
    loanBorrowers: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }],
    form1084Audits: [{ id: CALCULATION }],
    auditEvents: [{
      id: APPROVAL,
      action: 'INCOME_APPROVED',
      entityId: CALCULATION,
      expectedLoanVersion: 3,
      actorUserId: USER,
      occurredAt: APPROVED_AT,
    }],
  };
  const calculation = {
    id: CALCULATION,
    calculatedLoanVersion: 3,
    calculationSchemaVersion: 'authoritative-extractions-v1',
    calculationSource: 'persisted-parser-extractions',
    mortgageRuleVersion: 'form-1084-v9',
    canonicalInputHash: 'a'.repeat(64),
    sourceDocumentHashes: ['b'.repeat(64)],
    qualifyingMonthlyIncome: new Prisma.Decimal('8000.00'),
    totalAnnualCashFlow: new Prisma.Decimal('96000.00'),
    trendingResult: 'SINGLE_YEAR',
    yearsAnalyzed: [2025],
    w2BaseMonthly: new Prisma.Decimal('8000.00'),
    w2VariableMonthly: null,
    scheduleCMonthlyTotal: null,
    scheduleFMonthlyTotal: null,
    form1120SMonthlyTotal: null,
    form1065MonthlyTotal: null,
    form1120MonthlyTotal: null,
    assetIncomeMonthly: null,
    rentalMonthly: null,
    rentalLiabilityMonthly: null,
    housingExpenseAdjustment: null,
    borrowerIncome: null,
    verifiedAt: APPROVED_AT,
    verifiedByUserId: USER,
    extractionBindings: [{
      extractionId: '00000000-0000-4000-8000-000000000500',
      extractionHash: 'c'.repeat(64),
      sourceDocumentId: '00000000-0000-4000-8000-000000000600',
      sourceDocumentVersion: 1,
      sourceContentHash: 'b'.repeat(64),
      metadataReviewId: null,
      metadataReviewVersion: null,
      metadataReviewHash: null,
    }],
  };
  return {
    state,
    loanApplication: {
      findFirst: async ({ where }: { where: unknown }) => {
        state.loanWhere = where;
        return options.loanMissing ? null : loan;
      },
    },
    form1084Audit: {
      findFirst: async ({ where }: { where: unknown }) => {
        state.calculationQueried = true;
        state.calculationWhere = where;
        return calculation;
      },
    },
  };
}
