import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPersistableParserExtraction } from './persistedParserExtraction';

test('selects calculation fields and coordinate evidence without OCR or raw response data', () => {
  const result = selectPersistableParserExtraction({
    original_filename: 'borrower-secret.pdf',
    pages: [{ words: [{ text: 'never persist me' }] }],
    flags: ['LOW_CONFIDENCE'],
    w2Extracts: [{
      pageIndex: 0, year: 2025, employerName: 'Synthetic Employer', ein: '00-0000000', box1: 120000, box5: 121000,
      boxes: { box1: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    }],
    formExtracts: [{ form: 'W-2', ssn: '000-00-0000' }],
  });
  const employers = result.normalizedInput.w2Records as Array<Record<string, unknown>>;
  assert.equal(employers[0]?.annualWages, 120000);
  assert.equal(employers[0]?.role, undefined);
  assert.equal(result.schemaVersion, 'income-extraction-v2');
  assert.equal(result.canonicalHash.length, 64);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('never persist me'), false);
  assert.equal(serialized.includes('borrower-secret.pdf'), false);
  assert.equal(serialized.includes('000-00-0000'), false);
});

test('is deterministic and fails closed for unsupported or incomplete parser output', () => {
  const input = { w2Extracts: [{ pageIndex: 1, year: 2024, employerName: 'Synthetic Employer', box1: 90000 }] };
  assert.equal(selectPersistableParserExtraction(input).canonicalHash, selectPersistableParserExtraction(input).canonicalHash);
  assert.throws(() => selectPersistableParserExtraction({ pages: [{ words: [] }] }));
  assert.throws(() => selectPersistableParserExtraction({ w2Extracts: [{ pageIndex: 0, year: null, employerName: 'Synthetic', box1: 1 }] }));
});

test('persists only allowlisted parser form fields and marks missing tax year', () => {
  const result = selectPersistableParserExtraction({ formExtracts: [{
    form: 'Schedule C', pageIndex: 2, entityId: 'business-1', sourceFieldId: 'ent1-net', numericValue: 1000,
    value: '1000', box: { x: 0.1, y: 0.2, w: 0.2, h: 0.03 }, ssn: 'never-persist',
  }] });
  assert.deepEqual(result.normalizedInput, { formRecords: [{
    entityId: 'Schedule C:business-1', form: 'Schedule C', pageIndex: 2,
    fields: [{ sourceFieldId: 'ent1-net', value: '1000', numericValue: 1000 }],
  }] });
  assert.ok(result.warnings.includes('AUTHORITATIVE_TAX_YEAR_REQUIRED'));
  assert.equal(JSON.stringify(result).includes('never-persist'), false);
});

test('accepts the parser fields emitted by the controlled-pilot paystub and Form 1065 fixtures', () => {
  const result = selectPersistableParserExtraction({ formExtracts: [
    { form: 'Paystub', pageIndex: 0, entityId: 'paystub-p0', sourceFieldId: 'ps-employer-name', value: 'Synthetic Employer' },
    { form: 'Paystub', pageIndex: 0, entityId: 'paystub-p0', sourceFieldId: 'ps-base-ytd', value: '54000.00', numericValue: 54000 },
    { form: 'Paystub', pageIndex: 0, entityId: 'paystub-p0', sourceFieldId: 'borrower-ssn', value: '000-00-0000' },
    { form: 'Form 1065', pageIndex: 0, entityId: 'partnership-p0', sourceFieldId: 'pt-return-name', value: 'Synthetic Partnership' },
    { form: 'Form 1065', pageIndex: 0, entityId: 'partnership-p0', sourceFieldId: 'pt-return-ord', value: '12000.00', numericValue: 12000 },
  ] });

  assert.deepEqual(result.normalizedInput, { formRecords: [
    {
      entityId: 'Form 1065:partnership-p0', form: 'Form 1065', pageIndex: 0,
      fields: [
        { sourceFieldId: 'pt-return-name', value: 'Synthetic Partnership' },
        { sourceFieldId: 'pt-return-ord', value: '12000.00', numericValue: 12000 },
      ],
    },
    {
      entityId: 'Paystub:paystub-p0', form: 'Paystub', pageIndex: 0,
      fields: [
        { sourceFieldId: 'ps-base-ytd', value: '54000.00', numericValue: 54000 },
        { sourceFieldId: 'ps-employer-name', value: 'Synthetic Employer' },
      ],
    },
  ] });
  assert.equal(JSON.stringify(result).includes('000-00-0000'), false);
});

test('accepts allowlisted Form 1120-S return evidence without persisting unrelated fields', () => {
  const result = selectPersistableParserExtraction({ formExtracts: [
    { form: 'Form 1120-S', pageIndex: 0, entityId: 'scorp-return-p0', sourceFieldId: 'scorp-return-name', value: 'Synthetic S Corporation' },
    { form: 'Form 1120-S', pageIndex: 0, entityId: 'scorp-return-p0', sourceFieldId: 'scorp-return-ord', value: '32000.00', numericValue: 32000 },
    { form: 'Form 1120-S', pageIndex: 0, entityId: 'scorp-return-p0', sourceFieldId: 'borrower-ssn', value: '000-00-0000' },
  ] });

  assert.deepEqual(result.normalizedInput, { formRecords: [{
    entityId: 'Form 1120-S:scorp-return-p0', form: 'Form 1120-S', pageIndex: 0,
    fields: [
      { sourceFieldId: 'scorp-return-name', value: 'Synthetic S Corporation' },
      { sourceFieldId: 'scorp-return-ord', value: '32000.00', numericValue: 32000 },
    ],
  }] });
  assert.equal(JSON.stringify(result).includes('000-00-0000'), false);
});
