export type HostLoanContext = Readonly<{ loanGuid: string; readOnly: boolean; fields: Readonly<Record<string, string>> }>;
export type HostWriteResult = Readonly<{ loanGuid: string; fieldCount: number; committed: true }>;

export class EncompassHostError extends Error {
  constructor(readonly code: 'ENCOMPASS_HOST_UNAVAILABLE' | 'ENCOMPASS_LOAN_CONTEXT_CHANGED' | 'ENCOMPASS_LOAN_READ_ONLY' | 'ENCOMPASS_FIELD_NOT_ALLOWED' | 'ENCOMPASS_COMMIT_NOT_CONFIRMED', message: string) { super(message); }
}

export type EncompassLoanObject = Readonly<{
  all(): Promise<unknown>;
  getField(fieldId: string): Promise<unknown>;
  setFields(fields: Record<string, string>): Promise<unknown>;
  isReadOnly(): Promise<boolean>;
  calculate(): Promise<unknown>;
  commit(): Promise<unknown>;
}>;
export type EncompassScriptObject = Readonly<{ getObject(name: 'loan'): Promise<EncompassLoanObject> }>;
export type EncompassHostBridge = Readonly<{
  available(): boolean;
  activeLoan(fields?: readonly string[]): Promise<HostLoanContext>;
  writeApprovedResult(expectedLoanGuid: string, fields: Readonly<Record<string, string>>): Promise<HostWriteResult>;
}>;

const FREEFLOW_FIELD = /^CX\.FREEFLOW\.[A-Z0-9.]+$/;

function readLoanGuid(value: unknown): string {
  if (!value || typeof value !== 'object') throw new EncompassHostError('ENCOMPASS_HOST_UNAVAILABLE', 'The active Encompass loan is unavailable.');
  const record = value as Record<string, unknown>;
  const candidate = [record.id, record.loanId, record.guid].find((item) => typeof item === 'string' && item.trim().length > 0);
  if (typeof candidate !== 'string' || candidate.length > 255) throw new EncompassHostError('ENCOMPASS_HOST_UNAVAILABLE', 'The active Encompass loan identifier is unavailable.');
  return candidate;
}

export function createEncompassHostBridge(script: EncompassScriptObject | undefined): EncompassHostBridge {
  const loan = async () => {
    if (!script) throw new EncompassHostError('ENCOMPASS_HOST_UNAVAILABLE', 'FreeFlow must be launched from Encompass.');
    return script.getObject('loan');
  };
  const current = async (requested: readonly string[] = []): Promise<HostLoanContext> => {
    const hostLoan = await loan();
    const [all, readOnly, values] = await Promise.all([hostLoan.all(), hostLoan.isReadOnly(), Promise.all(requested.map(async (field) => [field, await hostLoan.getField(field)] as const))]);
    return { loanGuid: readLoanGuid(all), readOnly, fields: Object.fromEntries(values.filter(([, value]) => typeof value === 'string').map(([field, value]) => [field, String(value)])) };
  };
  return {
    available: () => Boolean(script),
    activeLoan: current,
    writeApprovedResult: async (expectedLoanGuid, fields) => {
      const before = await current();
      if (before.loanGuid !== expectedLoanGuid) throw new EncompassHostError('ENCOMPASS_LOAN_CONTEXT_CHANGED', 'The active Encompass loan changed. Reload before writing results.');
      if (before.readOnly) throw new EncompassHostError('ENCOMPASS_LOAN_READ_ONLY', 'The active Encompass loan is read-only.');
      if (!Object.keys(fields).length || Object.entries(fields).some(([name, value]) => !FREEFLOW_FIELD.test(name) || typeof value !== 'string' || value.length > 500)) {
        throw new EncompassHostError('ENCOMPASS_FIELD_NOT_ALLOWED', 'The requested Encompass field update is not allowed.');
      }
      const hostLoan = await loan();
      const beforeWrite = await current();
      if (beforeWrite.loanGuid !== expectedLoanGuid) throw new EncompassHostError('ENCOMPASS_LOAN_CONTEXT_CHANGED', 'The active Encompass loan changed. Reload before writing results.');
      await hostLoan.setFields({ ...fields });
      await hostLoan.calculate();
      await hostLoan.commit();
      const readback = await Promise.all(Object.entries(fields).map(async ([fieldName, expectedValue]) => ({
        fieldName,
        expectedValue,
        actualValue: await hostLoan.getField(fieldName),
      })));
      if (readback.some(({ expectedValue, actualValue }) => actualValue !== expectedValue)) {
        throw new EncompassHostError('ENCOMPASS_COMMIT_NOT_CONFIRMED', 'Encompass did not confirm every approved result field.');
      }
      return { loanGuid: expectedLoanGuid, fieldCount: Object.keys(fields).length, committed: true };
    },
  };
}

export function browserEncompassHostBridge(): EncompassHostBridge {
  const candidate = (globalThis as typeof globalThis & { elli?: { script?: EncompassScriptObject } }).elli?.script;
  return createEncompassHostBridge(candidate);
}
