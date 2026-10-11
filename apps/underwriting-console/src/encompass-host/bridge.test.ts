import assert from 'node:assert/strict';
import test from 'node:test';
import { createEncompassHostBridge, EncompassHostError } from './bridge';

function host(overrides: Partial<any> = {}) { const calls: string[] = []; const written: Record<string, string> = {}; const loan = { all: async () => ({ id: overrides.id ?? 'encompass-loan-1' }), getField: async (field: string) => written[field] ?? 'value', isReadOnly: async () => Boolean(overrides.readOnly), setFields: async (fields: Record<string, string>) => { Object.assign(written, fields); calls.push('set'); }, calculate: async () => { calls.push('calculate'); }, commit: async () => { calls.push('commit'); }, ...overrides.loan }; return { calls, bridge: createEncompassHostBridge({ getObject: async () => loan }) }; }
test('resolves an active Encompass loan through the host object', async () => { const { bridge } = host(); assert.equal((await bridge.activeLoan(['4000'])).loanGuid, 'encompass-loan-1'); });
test('writes allowlisted result fields once then calculates, commits, and confirms every field', async () => { const value = host(); await value.bridge.writeApprovedResult('encompass-loan-1', { 'CX.FREEFLOW.INCOME': '8200.00', 'CX.FREEFLOW.APPROVAL.ID': 'approval-1' }); assert.deepEqual(value.calls, ['set', 'calculate', 'commit']); });
test('fails closed when any approved field differs after commit', async () => {
  const value = host({ loan: { getField: async (field: string) => field === 'CX.FREEFLOW.INCOME' ? '8100.00' : 'approval-1' } });
  await assert.rejects(
    () => value.bridge.writeApprovedResult('encompass-loan-1', { 'CX.FREEFLOW.INCOME': '8200.00', 'CX.FREEFLOW.APPROVAL.ID': 'approval-1' }),
    (error: unknown) => error instanceof EncompassHostError && error.code === 'ENCOMPASS_COMMIT_NOT_CONFIRMED',
  );
});
test('fails closed on changed or read-only host loans', async () => { const changing = host({ loan: { all: (() => { let i = 0; return async () => ({ id: i++ ? 'other' : 'encompass-loan-1' }); })() } }); await assert.rejects(() => changing.bridge.writeApprovedResult('encompass-loan-1', { 'CX.FREEFLOW.INCOME': '1', 'CX.FREEFLOW.APPROVAL.ID': 'approval-1' }), (error: unknown) => error instanceof EncompassHostError && error.code === 'ENCOMPASS_LOAN_CONTEXT_CHANGED'); const readOnly = host({ readOnly: true }); await assert.rejects(() => readOnly.bridge.writeApprovedResult('encompass-loan-1', { 'CX.FREEFLOW.INCOME': '1', 'CX.FREEFLOW.APPROVAL.ID': 'approval-1' }), (error: unknown) => error instanceof EncompassHostError && error.code === 'ENCOMPASS_LOAN_READ_ONLY'); });
