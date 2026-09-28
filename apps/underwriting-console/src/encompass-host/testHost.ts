import { createEncompassHostBridge, type EncompassHostBridge, type EncompassScriptObject } from './bridge';

export type TestHostScenario = 'normal' | 'read-only' | 'changed-loan' | 'commit-failure';

export type DeterministicTestHost = Readonly<{
  bridge: EncompassHostBridge;
  snapshot(): Readonly<{ fields: Readonly<Record<string, string>>; calls: readonly string[] }>;
}>;

export function createDeterministicTestHost(
  loanGuid: string,
  scenario: TestHostScenario = 'normal',
): DeterministicTestHost {
  const fields: Record<string, string> = {};
  const calls: string[] = [];
  let reads = 0;
  const script: EncompassScriptObject = {
    async getObject() {
      return {
        async all() {
          reads += 1;
          return { id: scenario === 'changed-loan' && reads > 1 ? `${loanGuid}-changed` : loanGuid };
        },
        async getField(fieldId) { return fields[fieldId] ?? ''; },
        async isReadOnly() { return scenario === 'read-only'; },
        async setFields(values) { Object.assign(fields, values); calls.push('setFields'); },
        async calculate() { calls.push('calculate'); },
        async commit() {
          calls.push('commit');
          if (scenario === 'commit-failure') throw new Error('TEST_HOST_COMMIT_FAILURE');
        },
      };
    },
  };
  return {
    bridge: createEncompassHostBridge(script),
    snapshot: () => ({ fields: { ...fields }, calls: [...calls] }),
  };
}
