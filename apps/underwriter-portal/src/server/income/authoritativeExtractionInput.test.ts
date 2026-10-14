import assert from 'node:assert/strict';
import test from 'node:test';
import { annualizePaystub } from '@mortgage-pos/mortgage-engine';
import { ExtractionMetadataRequiredError, mergeAuthoritativeExtractionInputs } from './authoritativeExtractionInput';
import { hasCurrentCalculationExtractions } from './extractionFreshness';

test('merges only validated persisted extraction input and namespaces local entity ids', () => {
  const result = mergeAuthoritativeExtractionInputs([{
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: {
      w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 120000, pageIndex: 0, box1Wages: 120000, box5Wages: 121000 }],
    },
    metadataAssignments: [{ entityId: 'w2-p0-0', employmentRole: 'CURRENT' }],
  }]);
  assert.equal(result.w2Employers?.[0].annualWages, 121000);
  assert.equal(result.w2Employers?.[0].entityId, '00000000-0000-4000-8000-000000000101:w2-p0-0');
  assert.equal('pageIndex' in (result.w2Employers?.[0] ?? {}), false);
  assert.equal('box1Wages' in (result.w2Employers?.[0] ?? {}), false);
  assert.equal('box5Wages' in (result.w2Employers?.[0] ?? {}), false);
});

test('W-2 calculation uses Box 5 and fails closed when Box 5 was not extracted', () => {
  const extractionId = '00000000-0000-4000-8000-000000000108';
  const metadataAssignments = [{ entityId: 'w2-p0-0', employmentRole: 'CURRENT' as const }];
  const projected = mergeAuthoritativeExtractionInputs([{
    extractionId,
    normalizedInput: {
      w2Records: [{
        entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025,
        annualWages: 159550.98, box1Wages: 159550.98, box5Wages: 142800,
      }],
    },
    metadataAssignments,
  }]);
  assert.equal(projected.w2Employers?.[0].annualWages, 142800);

  assert.throws(() => mergeAuthoritativeExtractionInputs([{
    extractionId,
    normalizedInput: {
      w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 159550.98, box1Wages: 159550.98, box5Wages: 0 }],
    },
    metadataAssignments,
  }]), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements, [{ extractionId, entityId: 'w2-p0-0', field: 'requiredParserField', form: 'W-2' }]);
    return true;
  });
});

test('strips Schedule E display metadata before authoritative calculation projection', () => {
  const result = mergeAuthoritativeExtractionInputs([{
    extractionId: '00000000-0000-4000-8000-000000000102',
    normalizedInput: {
      scheduleEProperties: [{
        entityId: 'schedule-e-p2-b', year: 2025, propertyAddress: '100 Synthetic Lane',
        propertyType: 'RENTAL', rentsReceived: 24000, netIncomeLoss: 12000, pageIndex: 2, column: 'B',
      }],
    },
  }]);

  const property = result.scheduleEProperties?.[0] as unknown as (Record<string, unknown> | undefined);
  assert.equal(property?.rentsReceived, 24000);
  assert.equal(property?.netIncomeLoss, 12000);
  assert.equal(property?.entityId, '00000000-0000-4000-8000-000000000102:schedule-e-0');
  assert.equal('pageIndex' in (property ?? {}), false);
  assert.equal('column' in (property ?? {}), false);
});

test('returns exact reviewed metadata requirements and projects supported non-W2 records', () => {
  const record = {
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: { formRecords: [{ entityId: 'Schedule C:business-1', form: 'Schedule C', pageIndex: 1, fields: [
      { sourceFieldId: 'ent1-name', value: 'Synthetic Consulting' }, { sourceFieldId: 'ent1-net', numericValue: 96000 },
    ] }] },
  };
  assert.throws(() => mergeAuthoritativeExtractionInputs([record]), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements, [{ extractionId: record.extractionId, entityId: 'Schedule C:business-1', field: 'taxYear', form: 'Schedule C' }]);
    return true;
  });
  const projected = mergeAuthoritativeExtractionInputs([{ ...record, metadataAssignments: [{ entityId: 'Schedule C:business-1', taxYear: 2025 }] }]);
  assert.equal(projected.scheduleC?.[0].netProfitLoss, 96000);
  assert.equal(projected.scheduleC?.[0].year, 2025);
});

test('rejects unknown or malformed persisted calculation fields', () => {
  assert.throws(() => mergeAuthoritativeExtractionInputs([{
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: { rawOcrText: 'must never be accepted' },
  }]));
});

test('incomplete paystub stays GAPS and a reviewed stub projects annualizePaystub', () => {
  const extractionId = '00000000-0000-4000-8000-000000000101';
  const normalizedInput = { formRecords: [{
    entityId: 'Paystub:paystub-p0', form: 'Paystub', pageIndex: 0,
    fields: [
      { sourceFieldId: 'ps-employer-name', value: 'Synthetic Employer' },
      { sourceFieldId: 'ps-base-ytd', numericValue: 54000 },
    ],
  }] };
  const gapped = annualizePaystub({ baseYtd: 54000 });
  assert.equal(gapped.status, 'GAPS');
  assert.ok(gapped.gaps.includes('ELAPSED_MONTHS_REQUIRED'));
  assert.throws(() => mergeAuthoritativeExtractionInputs([{ extractionId, normalizedInput }], { borrowerRoster: ['borrower-1', 'borrower-2'] }), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements.map((item) => item.field), ['borrowerAssignment', 'elapsedMonths', 'employmentRole', 'taxYear']);
    return true;
  });
  const cited = annualizePaystub({ baseYtd: 54000, elapsedMonths: 7.5, baseMethod: 'ytd' });
  const projected = mergeAuthoritativeExtractionInputs([{
    extractionId,
    normalizedInput,
    metadataAssignments: [{ entityId: 'Paystub:paystub-p0', employmentRole: 'CURRENT' as const, taxYear: 2025, borrowerKey: 'borrower-1', elapsedMonths: 7.5, baseIncomeMethod: 'ytd' as const }],
  }], { borrowerRoster: ['borrower-1', 'borrower-2'] });
  const row = projected.w2Employers?.[0];
  assert.equal(row?.annualBaseIncome, cited.annualBase);
  assert.equal(row?.annualVariableIncome, cited.annualVariable);
  assert.equal(row?.annualWages, undefined);
  assert.notEqual(row?.annualBaseIncome, 54000);
  assert.equal(row?.entityId, `${extractionId}:Paystub:paystub-p0`);
});

test('calculation extraction freshness binds active hash and source document version', () => {
  const current = [{
    extractionId: 'extraction', extractionHash: 'a'.repeat(64), sourceDocumentId: 'document',
    sourceDocumentVersion: 2, sourceContentHash: 'b'.repeat(64),
    extraction: {
      status: 'ACTIVE' as const, canonicalHash: 'a'.repeat(64), sourceDocumentVersion: 2,
      sourceContentHash: 'b'.repeat(64), sourceDocument: { version: 2, sourceContentHash: 'b'.repeat(64) },
    },
  }];
  assert.equal(hasCurrentCalculationExtractions(current), true);
  assert.equal(hasCurrentCalculationExtractions([{ ...current[0], extraction: { ...current[0].extraction, status: 'SUPERSEDED' } }]), false);
  assert.equal(hasCurrentCalculationExtractions([{ ...current[0], extraction: { ...current[0].extraction, sourceDocument: { version: 3, sourceContentHash: 'b'.repeat(64) } } }]), false);
});

test('Form 1065 return-only pages are skipped and do not fail-close beside a K-1', () => {
  const returnId = '00000000-0000-4000-8000-000000000201';
  const k1Id = '00000000-0000-4000-8000-000000000202';
  const returnExtraction = {
    extractionId: returnId,
    normalizedInput: { formRecords: [
      { entityId: 'form-1065-p0', form: 'Form 1065', pageIndex: 0, fields: [
        { sourceFieldId: 'pt-return-name', value: 'Riverbend Holdings LLC' },
        { sourceFieldId: 'pt-return-ein', value: '86-1234567' },
        { sourceFieldId: 'pt-return-ord', value: '4570.00', numericValue: 4570 },
      ] },
      { entityId: 'form-1065-p5', form: 'Form 1065', pageIndex: 5, fields: [
        { sourceFieldId: 'pt-return-dep', numericValue: 21750 },
        { sourceFieldId: 'pt-return-meals', numericValue: 800 },
      ] },
    ] },
    metadataAssignments: [
      { entityId: 'form-1065-p0', taxYear: 2024, ownershipPercentage: 100 },
      { entityId: 'form-1065-p5', taxYear: 2024, ownershipPercentage: 100 },
    ],
  };
  const returnsOnly = mergeAuthoritativeExtractionInputs([returnExtraction]);
  assert.equal(returnsOnly.form1065, undefined);
  const projected = mergeAuthoritativeExtractionInputs([
    returnExtraction,
    {
      extractionId: k1Id,
      normalizedInput: { formRecords: [{ entityId: 'form-1065-p6', form: 'Form 1065', pageIndex: 6, fields: [
        { sourceFieldId: 'pt-name', value: 'Riverbend Holdings LLC' },
        { sourceFieldId: 'pt-ein', value: '86-1234567' },
        { sourceFieldId: 'pt-ord', numericValue: 42000 },
        { sourceFieldId: 'pt-rre', numericValue: 3000 },
        { sourceFieldId: 'pt-gp', numericValue: 12000 },
        { sourceFieldId: 'pt-dist', numericValue: 42000 },
        { sourceFieldId: 'pt-profit-pct', numericValue: 25 },
        { sourceFieldId: 'pt-return-ord', numericValue: 4570 },
      ] }] },
      metadataAssignments: [{ entityId: 'form-1065-p6', taxYear: 2024 }],
    },
  ]);
  assert.equal(projected.form1065?.length, 1);
  const row = projected.form1065?.[0];
  assert.equal(row?.entityId, `${k1Id}:form-1065-p6`);
  assert.equal(row?.k1OrdinaryIncome, 42000);
  assert.equal(row?.k1NetRentalRealEstate, 3000);
  assert.equal(row?.k1GuaranteedPayments, 12000);
  assert.equal(row?.k1Distributions, 42000);
  assert.equal(row?.ownershipPercentage, 25);
  assert.equal(row?.businessName, 'Riverbend Holdings LLC');
});

test('Form 1065 K-1 pt-* still projects without a return page', () => {
  const extractionId = '00000000-0000-4000-8000-000000000203';
  const projected = mergeAuthoritativeExtractionInputs([{
    extractionId,
    normalizedInput: { formRecords: [{ entityId: 'form-1065-k1', form: 'Form 1065', pageIndex: 3, fields: [
      { sourceFieldId: 'pt-name', value: 'Synthetic Partnership' },
      { sourceFieldId: 'pt-ord', numericValue: 60000 },
      { sourceFieldId: 'pt-onr', numericValue: 1500 },
      { sourceFieldId: 'pt-capital-pct', numericValue: 40 },
    ] }] },
    metadataAssignments: [{ entityId: 'form-1065-k1', taxYear: 2025 }],
  }]);
  assert.equal(projected.form1065?.length, 1);
  assert.equal(projected.form1065?.[0].entityId, `${extractionId}:form-1065-k1`);
  assert.equal(projected.form1065?.[0].k1OrdinaryIncome, 60000);
  assert.equal(projected.form1065?.[0].k1OtherNetRentalIncome, 1500);
  assert.equal(projected.form1065?.[0].ownershipPercentage, 40);
  assert.equal(projected.form1065?.[0].capitalPercentageEnd, 40);
});

test('Form 1065 missing K-1 income still fail-closes when the record is not return-only', () => {
  const extractionId = '00000000-0000-4000-8000-000000000204';
  const empty = {
    extractionId,
    normalizedInput: { formRecords: [{ entityId: 'form-1065-p3', form: 'Form 1065', pageIndex: 3, fields: [
      { sourceFieldId: 'pt-name', value: 'Empty Partnership' },
    ] }] },
    metadataAssignments: [{ entityId: 'form-1065-p3', taxYear: 2024, ownershipPercentage: 50 }],
  };
  assert.throws(() => mergeAuthoritativeExtractionInputs([empty]), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements, [{ extractionId, entityId: 'form-1065-p3', field: 'requiredParserField', form: 'Form 1065' }]);
    return true;
  });
  const mixed = {
    extractionId,
    normalizedInput: { formRecords: [{ entityId: 'form-1065-p4', form: 'Form 1065', pageIndex: 4, fields: [
      { sourceFieldId: 'pt-return-ord', numericValue: 4570 },
      { sourceFieldId: 'pt-profit-pct', numericValue: 25 },
    ] }] },
    metadataAssignments: [{ entityId: 'form-1065-p4', taxYear: 2024 }],
  };
  assert.throws(() => mergeAuthoritativeExtractionInputs([mixed]), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements, [{ extractionId, entityId: 'form-1065-p4', field: 'requiredParserField', form: 'Form 1065' }]);
    return true;
  });
});

test('Form 1120-S return-only pages are skipped while K-1 income remains authoritative', () => {
  const returnId = '00000000-0000-4000-8000-000000000205';
  const k1Id = '00000000-0000-4000-8000-000000000206';
  const returnExtraction = {
    extractionId: returnId,
    normalizedInput: { formRecords: [{ entityId: 'form-1120s-p0', form: 'Form 1120-S', pageIndex: 0, fields: [
      { sourceFieldId: 'scorp-return-name', value: 'Synthetic S Corporation' },
      { sourceFieldId: 'scorp-return-ein', value: '00-0000000' },
      { sourceFieldId: 'scorp-return-ord', numericValue: 32000 },
    ] }] },
    metadataAssignments: [{ entityId: 'form-1120s-p0', taxYear: 2024, ownershipPercentage: 100 }],
  };
  assert.equal(mergeAuthoritativeExtractionInputs([returnExtraction]).form1120S, undefined);

  const projected = mergeAuthoritativeExtractionInputs([
    returnExtraction,
    {
      extractionId: k1Id,
      normalizedInput: { formRecords: [{ entityId: 'form-1120s-k1', form: 'Form 1120-S', pageIndex: 4, fields: [
        { sourceFieldId: 'scorp-name', value: 'Synthetic S Corporation' },
        { sourceFieldId: 'scorp-ord', numericValue: 48000 },
        { sourceFieldId: 'scorp-dist', numericValue: 36000 },
        { sourceFieldId: 'scorp-own-pct', numericValue: 40 },
      ] }] },
      metadataAssignments: [{ entityId: 'form-1120s-k1', taxYear: 2024 }],
    },
  ]);
  assert.equal(projected.form1120S?.length, 1);
  assert.equal(projected.form1120S?.[0].entityId, `${k1Id}:form-1120s-k1`);
  assert.equal(projected.form1120S?.[0].k1OrdinaryIncome, 48000);
  assert.equal(projected.form1120S?.[0].k1Distributions, 36000);
  assert.equal(projected.form1120S?.[0].ownershipPercentage, 40);
});

test('Form 1120-S non-return records without K-1 income still fail closed', () => {
  const extractionId = '00000000-0000-4000-8000-000000000207';
  const mixed = {
    extractionId,
    normalizedInput: { formRecords: [{ entityId: 'form-1120s-mixed', form: 'Form 1120-S', pageIndex: 3, fields: [
      { sourceFieldId: 'scorp-return-ord', numericValue: 32000 },
      { sourceFieldId: 'scorp-own-pct', numericValue: 25 },
    ] }] },
    metadataAssignments: [{ entityId: 'form-1120s-mixed', taxYear: 2024 }],
  };
  assert.throws(() => mergeAuthoritativeExtractionInputs([mixed]), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements, [{ extractionId, entityId: 'form-1120s-mixed', field: 'requiredParserField', form: 'Form 1120-S' }]);
    return true;
  });
});

test('a newer reviewed metadata version invalidates calculation provenance', () => {
  const binding = {
    extractionId: 'extraction', extractionHash: 'a'.repeat(64), sourceDocumentId: 'document', sourceDocumentVersion: 2,
    sourceContentHash: 'b'.repeat(64), metadataReviewId: 'review-1', metadataReviewVersion: 1, metadataReviewHash: 'c'.repeat(64),
    extraction: { status: 'ACTIVE' as const, canonicalHash: 'a'.repeat(64), sourceDocumentVersion: 2, sourceContentHash: 'b'.repeat(64),
      sourceDocument: { version: 2, sourceContentHash: 'b'.repeat(64) }, metadataReviews: [{ id: 'review-2', metadataVersion: 2, canonicalHash: 'd'.repeat(64) }],
    },
  };
  assert.equal(hasCurrentCalculationExtractions([binding]), false);
});

test('Form 1040 IRA distributions require entered balance and underwriter continuance before projecting', () => {
  const entityId = 'form-1040-p0';
  const record = {
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: { formRecords: [{ entityId, form: 'Form 1040', pageIndex: 0, fields: [
      { sourceFieldId: 'f1040-ira-total', numericValue: 24000 }, { sourceFieldId: 'f1040-ira-taxable', numericValue: 18000 },
      { sourceFieldId: 'f1040-ss-total', numericValue: 26400 }, { sourceFieldId: 'f1040-ss-taxable', numericValue: 22440 },
    ] }] },
  };
  assert.throws(() => mergeAuthoritativeExtractionInputs([{ ...record, metadataAssignments: [{ entityId, taxYear: 2025 }] }]), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements.map((item) => item.field), ['iraAccountBalance', 'iraContinuance']);
    return true;
  });
  const projected = mergeAuthoritativeExtractionInputs([{ ...record, metadataAssignments: [{
    entityId, taxYear: 2025, iraAccountBalance: 400000, hasThreeYearIraContinuance: true, grossUpIraNonTaxable: true,
  }] }]);
  assert.deepEqual(projected.iraDistributions, [{
    entityId: `${record.extractionId}:${entityId}`, year: 2025, totalDistributions: 24000, taxableDistributions: 18000, accountBalance: 400000,
    hasThreeYearContinuance: true, grossUpNonTaxable: true,
  }]);
  assert.equal(projected.benefits?.[0].totalSocialSecurity, 26400);
});

test('Form 1040 IRA gross-up is dropped when the underwriter does not confirm continuance', () => {
  const entityId = 'form-1040-p0';
  const projected = mergeAuthoritativeExtractionInputs([{
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: { formRecords: [{ entityId, form: 'Form 1040', pageIndex: 0, fields: [{ sourceFieldId: 'f1040-ira-taxable', numericValue: 30000 }] }] },
    metadataAssignments: [{ entityId, taxYear: 2025, iraAccountBalance: 0, hasThreeYearIraContinuance: false, grossUpIraNonTaxable: true }],
  }]);
  assert.equal(projected.benefits, undefined);
  assert.deepEqual(projected.iraDistributions, [{ entityId: `00000000-0000-4000-8000-000000000101:${entityId}`, year: 2025, taxableDistributions: 30000, accountBalance: 0, hasThreeYearContinuance: false, grossUpNonTaxable: false }]);
});
