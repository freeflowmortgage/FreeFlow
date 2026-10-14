import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRequirementValue,
  deriveProtectedWorkflowState,
  describeIraContinuance,
  programGrossUpMultiplier,
  readEvidenceFields,
  readIraReturnAmounts,
  reviewEntityLabel,
  reviewFieldLabel,
  type ConsoleContext,
} from './protectedWorkflow';

const base = {
  loan: { id: 'loan', version: 1, status: 'DRAFT', program: 'CONVENTIONAL', borrowerName: null },
  attachments: [], extractions: [], calculation: null, approval: null, hostWrite: null,
} as unknown as ConsoleContext;

test('derives the protected workflow only from authoritative context and review requirements', () => {
  assert.equal(deriveProtectedWorkflowState(null, null, false), 'NO_LOAN_CONTEXT');
  assert.equal(deriveProtectedWorkflowState(base, [], true), 'BOUND');
  const uploaded = { ...base, attachments: [{ attachmentId: 'a' }] } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(uploaded, [], true), 'DOCUMENT_UPLOADED');
  const extracted = { ...uploaded, extractions: [{ id: 'e', status: 'ACTIVE' }] } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(extracted, null, true), 'EXTRACTED');
  assert.equal(deriveProtectedWorkflowState(extracted, [{ extractionId: 'e', entityId: 'w2', field: 'employmentRole', form: 'W-2' }], true), 'REVIEW_REQUIRED');
  assert.equal(deriveProtectedWorkflowState(extracted, [], true), 'READY_TO_CALCULATE');
  const calculated = { ...extracted, calculation: { id: 'c', current: true } } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(calculated, [], true), 'CALCULATED');
  const approved = { ...calculated, approval: { id: 'p', current: true } } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(approved, [], false), 'APPROVED');
  assert.equal(deriveProtectedWorkflowState(approved, [], true), 'READY_TO_WRITE');
  const written = { ...approved, hostWrite: { status: 'SUCCEEDED', certified: true, current: true } } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(written, [], true), 'WRITTEN');
  const staleWrite = { ...approved, approval: { id: 'p', current: false }, hostWrite: { status: 'SUCCEEDED', certified: false, current: false } } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(staleWrite, [], true), 'CALCULATED');
});

test('maps reviewed requirement fields onto borrower-scoped assignment keys', () => {
  const assignment: Record<string, string | number | boolean> = { entityId: 'paystub-1' };
  applyRequirementValue(assignment, 'borrowerAssignment', 'borrower-2');
  applyRequirementValue(assignment, 'assetElection', 'INCLUDE');
  applyRequirementValue(assignment, 'employmentRole', 'CURRENT');
  applyRequirementValue(assignment, 'elapsedMonths', '7.5');
  applyRequirementValue(assignment, 'unsupportedCalculation', 'ignored');
  assert.deepEqual(assignment, {
    entityId: 'paystub-1', borrowerKey: 'borrower-2', includeInQualifyingIncome: true, employmentRole: 'CURRENT', elapsedMonths: 7.5,
  });
});

test('accepts only bounded persisted coordinate evidence', () => {
  assert.deepEqual(readEvidenceFields({ fields: [
    { collection: 'formExtracts', entityId: 'entity', field: 'ent1-net', pageIndex: 2, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    { collection: 'bad', field: 'outside', pageIndex: 0, box: { x: -1, y: 0, w: 1, h: 1 } },
  ] }), [{ collection: 'formExtracts', entityId: 'entity', field: 'ent1-net', pageIndex: 2, box: [0.1, 0.2, 0.3, 0.04] }]);
});

test('uses underwriting-language review labels instead of internal metadata keys', () => {
  assert.equal(reviewFieldLabel('borrowerAssignment'), 'Borrower assignment');
  assert.equal(reviewFieldLabel('elapsedMonths'), 'Months elapsed year to date');
});

test('identifies Schedule E borrower assignments by property address', () => {
  const context = {
    ...base,
    extractions: [{
      id: 'extraction-1',
      normalizedInput: {
        scheduleEProperties: [
          { propertyAddress: '100 Synthetic Lane' },
          { propertyAddress: '200 Example Avenue' },
        ],
      },
    }],
  } as unknown as ConsoleContext;
  assert.equal(reviewEntityLabel(context, {
    extractionId: 'extraction-1', entityId: 'schedule-e-1', field: 'borrowerAssignment', form: 'Schedule E',
  }), 'Schedule E rental · 200 Example Avenue');
  assert.equal(reviewEntityLabel(context, {
    extractionId: 'extraction-1', entityId: 'schedule-e-9', field: 'borrowerAssignment', form: 'Schedule E',
  }), 'Schedule E rental property 10');
});

test('maps the underwriter IRA continuance decision onto continuance and gross-up flags', () => {
  const decide = (raw: string) => {
    const assignment: Record<string, string | number | boolean> = { entityId: 'form-1040-p0' };
    applyRequirementValue(assignment, 'iraAccountBalance', '400000');
    applyRequirementValue(assignment, 'iraContinuance', raw);
    return assignment;
  };
  assert.deepEqual(decide('CONFIRMED_GROSS_UP'), { entityId: 'form-1040-p0', iraAccountBalance: 400000, hasThreeYearIraContinuance: true, grossUpIraNonTaxable: true });
  assert.deepEqual(decide('CONFIRMED'), { entityId: 'form-1040-p0', iraAccountBalance: 400000, hasThreeYearIraContinuance: true, grossUpIraNonTaxable: false });
  assert.deepEqual(decide('NOT_CONFIRMED'), { entityId: 'form-1040-p0', iraAccountBalance: 400000, hasThreeYearIraContinuance: false, grossUpIraNonTaxable: false });
});

test('shows the most recent return IRA amounts, balance coverage, and program gross-up', () => {
  const requirement = { extractionId: 'e-1040', entityId: 'form-1040-p0', field: 'iraContinuance' as const, form: 'Form 1040' };
  const context = { extractions: [{ id: 'e-1040', normalizedInput: { formRecords: [{ entityId: 'form-1040-p0', form: 'Form 1040', pageIndex: 0, fields: [
    { sourceFieldId: 'f1040-ira-total', numericValue: 24000 }, { sourceFieldId: 'f1040-ira-taxable', numericValue: 18000 },
  ] }] } }] } as unknown as ConsoleContext;
  const amounts = readIraReturnAmounts(context, requirement);
  assert.deepEqual(amounts, { totalDistributions: 24000, taxableDistributions: 18000 });
  assert.equal(reviewEntityLabel(context, requirement), 'Form 1040 · IRA distributions $24,000 (Line 4a), $18,000 taxable (Line 4b)');
  assert.equal(programGrossUpMultiplier('FHA'), 1.15);
  assert.equal(programGrossUpMultiplier('VA'), 1.25);
  assert.deepEqual(describeIraContinuance(amounts!, '48000', 'FHA'), [
    'Most recent return: $2,000.00/mo (Line 4a ÷ 12), $6,000 non-taxable.',
    'Entered balance covers 24 months, short of the 36-month requirement.',
    'If confirmed: $2,000.00/mo, or $2,075.00/mo with the 15% FHA gross-up.',
  ]);
  assert.equal(describeIraContinuance(amounts!, '400000', 'CONVENTIONAL')[2], 'If confirmed: $2,000.00/mo, or $2,125.00/mo with the 25% CONVENTIONAL gross-up.');
});
