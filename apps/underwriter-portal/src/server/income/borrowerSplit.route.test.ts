import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { BORROWER_INCOME_SCHEMA_VERSION, W2_INCOME_RULE_VERSION } from '@mortgage-pos/mortgage-engine';
import type { RequestContext } from '../auth/requestContext';
import { hashCanonical } from '../http/canonical';
import borrowerSplitRoute, { config, createBorrowerSplitHandler } from '../../pages/api/v1/income/borrower-split';

const context: RequestContext = Object.freeze({
  requestId: 'request-1', subject: 'subject', tenantId: '00000000-0000-4000-8000-000000000100',
  membershipId: '00000000-0000-4000-8000-000000000101', permissions: ['income:calculate'] as const, authTime: new Date(),
});
const stub = {
  payFrequency: 'SEMIMONTHLY', hourlyRate: 45, weeklyHours: 40, currentPeriodBasePay: 3600,
  baseYtd: 54000, bonusYtd: 12500, overtimeYtd: 4200, monthsAtJob: 8,
};
const meridian = {
  id: 'w2-meridian', borrowerId: 'b2', payFrequency: 'BIWEEKLY', wageDocSource: 'WVOE', hourlyRate: 22,
  weeklyHours: 12, currentPeriodBasePay: 528, baseYtd: 7920, wvoeMonths: 24, monthsAtJob: 29, w2Year1Box5: 11440,
};
const jointFile = {
  borrowers: [{ id: 'b1' }, { id: 'b2' }],
  priorEmployer: { box5Wages: 78500, box12Bonus: 18000, box14Overtime: 6000 },
  w2Employers: [{ ...stub, id: 'w2-apex', borrowerId: 'b1' }, meridian],
  rentalMonthly: 900,
};

type BorrowerSplitBody = {
  schemaVersion: string; ruleVersion: string; requestId: string; inputHash: string;
  borrowers: Array<{ borrowerId: string; qualifyingMonthlyIncome: number }>;
  employers: Array<{ id: string; baseMonthly: number; variableMethodId: string }>;
  totals: { qualifyingMonthlyIncome: number };
};
type ErrorBody = { error: { code: string; requestId: string; issues?: Array<{ path: Array<string | number>; message: string }> } };

test('splits a joint file per borrower and returns provenance', async () => {
  const { response, state } = recorder();
  await createBorrowerSplitHandler()(request(jointFile), response, context);
  assert.equal(state.status, 200);
  const body = state.body as BorrowerSplitBody;
  assert.equal(body.schemaVersion, BORROWER_INCOME_SCHEMA_VERSION);
  assert.equal(body.ruleVersion, W2_INCOME_RULE_VERSION);
  assert.equal(body.requestId, 'request-1');
  assert.match(body.inputHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(body.borrowers.map((row) => row.borrowerId), ['b1', 'b2']);
  assert.ok(Math.abs(body.borrowers[0].qualifyingMonthlyIncome - (7200 + 2035 + 900)) < 1e-9);
  assert.ok(Math.abs(body.borrowers[1].qualifyingMonthlyIncome - 1144) < 1e-9);
  assert.equal(body.employers[0].variableMethodId, 'avg24');
});

test('two spouses with identical stubs get identical income', async () => {
  const { response, state } = recorder();
  await createBorrowerSplitHandler()(request({
    borrowers: [{ id: 'b1' }, { id: 'b2' }],
    w2Employers: [{ ...stub, id: 'e1', borrowerId: 'b1' }, { ...stub, id: 'e2', borrowerId: 'b2' }],
  }), response, context);
  assert.equal(state.status, 200);
  const [first, second] = (state.body as BorrowerSplitBody).borrowers;
  assert.equal(first.qualifyingMonthlyIncome, second.qualifyingMonthlyIncome);
});

test('inputHash covers the validated request, so key order and omitted defaults do not change it', async () => {
  const hashOf = async (body: unknown) => {
    const { response, state } = recorder();
    await createBorrowerSplitHandler()(request(body), response, context);
    return (state.body as BorrowerSplitBody).inputHash;
  };
  const minimal = { borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1', hourlyRate: 45 }] };
  const reordered = {
    w2Employers: [{ hourlyRate: 45, payFrequency: 'SEMIMONTHLY', id: 'e1' }],
    rentalMonthly: 0,
    borrowers: [{ id: 'b1' }],
  };
  const changed = { borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1', hourlyRate: 46 }] };
  assert.equal(await hashOf(minimal), await hashOf(reordered));
  assert.notEqual(await hashOf(minimal), await hashOf(changed));
  assert.equal(await hashOf(minimal), hashCanonical({
    borrowers: [{ id: 'b1' }],
    w2Employers: [{
      id: 'e1', payFrequency: 'SEMIMONTHLY', wageDocSource: 'PAYSTUB', hourlyRate: 45, weeklyHours: 0,
      currentPeriodBasePay: 0, baseYtd: 0, bonusYtd: 0, overtimeYtd: 0, tipsYtd: 0, commissionYtd: 0,
      wvoeBonus: 0, wvoeOvertime: 0, wvoeMonths: 0, monthsAtJob: 12, w2Year1Box5: 0,
    }],
    selfEmployed: [], rentalMonthly: 0, assetIncomeMonthly: 0,
  }));
});

test('validation errors return 400 with field paths and no submitted values', async () => {
  for (const body of [
    undefined,
    'borrowers=b1',
    { borrowers: [] },
    { borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1', borrowerId: 'b9' }] },
    { borrowers: [{ id: 'b1' }], ssn: '123-45-6789' },
    { borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1', baseYtd: -54000 }] },
  ]) {
    const { response, state } = recorder();
    await createBorrowerSplitHandler()(request(body), response, context);
    assert.equal(state.status, 400, JSON.stringify(body));
    const { error } = state.body as ErrorBody;
    assert.equal(error.code, 'INVALID_BORROWER_INCOME_REQUEST');
    assert.equal(error.requestId, 'request-1');
    assert.ok(error.issues && error.issues.length > 0);
    assert.doesNotMatch(JSON.stringify(error), /123-45-6789|54000/);
  }
});

test('an unknown owner is reported at its field path', async () => {
  const { response, state } = recorder();
  await createBorrowerSplitHandler()(request({ borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1', borrowerId: 'b9' }] }), response, context);
  assert.deepEqual((state.body as ErrorBody).error.issues, [
    { path: ['w2Employers', 0, 'borrowerId'], message: 'borrowerId must name a borrower on the request.' },
  ]);
});

test('only POST is allowed', async () => {
  const { response, state } = recorder();
  await createBorrowerSplitHandler()(request(jointFile, 'GET'), response, context);
  assert.equal(state.status, 405);
  assert.deepEqual(state.headers.allow, ['POST']);
});

test('a calculation failure returns a generic 500 without detail', async () => {
  const { response, state } = recorder();
  await createBorrowerSplitHandler({ calculate: () => { throw new Error('secret detail'); } })(request(jointFile), response, context);
  assert.equal(state.status, 500);
  assert.equal((state.body as ErrorBody).error.code, 'BORROWER_INCOME_CALCULATION_FAILED');
  assert.doesNotMatch(JSON.stringify(state.body), /secret detail/);
});

test('the route caps the request body', () => {
  assert.equal(config.api.bodyParser.sizeLimit, '64kb');
});

test('the route requires income:calculate and never touches the database', async () => {
  const saved = { ...process.env };
  const env = process.env as Record<string, string | undefined>;
  Object.assign(env, {
    NODE_ENV: 'test', FREEFLOW_RUNTIME_ENV: 'test', ALLOW_DEV_AUTH_BYPASS: 'true',
    DEV_AUTH_USER_ID: context.membershipId, DEV_AUTH_TENANT_ID: context.tenantId, DEV_AUTH_SUBJECT: 'dev-subject',
  });
  delete env.DATABASE_URL;
  try {
    for (const [role, status] of [['LOAN_OFFICER', 403], ['BORROWER', 403], ['PROCESSOR', 200], ['UNDERWRITER', 200]] as const) {
      env.DEV_AUTH_ROLE = role;
      const { response, state } = recorder();
      await borrowerSplitRoute(request(jointFile), response);
      assert.equal(state.status, status, role);
      if (status === 403) assert.equal((state.body as ErrorBody).error.code, 'PERMISSION_DENIED');
      else assert.equal((state.body as BorrowerSplitBody).requestId, state.headers['x-request-id']);
      assert.equal(state.headers['cache-control'], 'no-store');
    }
  } finally {
    for (const key of Object.keys(env)) if (!(key in saved)) delete env[key];
    Object.assign(env, saved);
  }
});

function request(body: unknown, method = 'POST'): NextApiRequest {
  return { method, query: {}, headers: {}, body } as NextApiRequest;
}

function recorder() {
  const state: { status?: number; body?: unknown; headers: Record<string, unknown> } = { headers: {} };
  const response = {
    headersSent: false,
    setHeader(name: string, value: unknown) { state.headers[name.toLowerCase()] = value; return response; },
    status(code: number) { state.status = code; return response; },
    json(body: unknown) { state.body = body; return response; },
  } as unknown as NextApiResponse;
  return { response, state };
}
