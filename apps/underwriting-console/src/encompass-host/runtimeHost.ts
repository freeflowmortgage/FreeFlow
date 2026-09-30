import { browserEncompassHostBridge, type EncompassHostBridge } from './bridge';
import { createDeterministicTestHost, type TestHostScenario } from './testHost';

export type ConsoleRuntimeConfiguration = Readonly<{
  testHost: Readonly<{
    enabled: boolean;
    loanGuid: string | null;
    borrowers?: readonly { borrowerKey: string; role: 'PRIMARY' | 'CO_BORROWER' }[];
  }>;
}>;

const SCENARIOS = new Set<TestHostScenario>(['normal', 'read-only', 'changed-loan', 'commit-failure']);

export async function loadConsoleRuntimeConfiguration(): Promise<ConsoleRuntimeConfiguration> {
  const response = await fetch('/runtime-config.json', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('CONSOLE_RUNTIME_CONFIGURATION_UNAVAILABLE');
  return response.json() as Promise<ConsoleRuntimeConfiguration>;
}

export function resolveEncompassHostBridge(
  configuration: ConsoleRuntimeConfiguration,
  search = globalThis.location?.search ?? '',
): EncompassHostBridge {
  if (!configuration.testHost.enabled) return browserEncompassHostBridge();
  if (!configuration.testHost.loanGuid) throw new Error('TEST_HOST_LOAN_GUID_REQUIRED');
  const requested = new URLSearchParams(search).get('testHostScenario') as TestHostScenario | null;
  const scenario = requested && SCENARIOS.has(requested) ? requested : 'normal';
  return createDeterministicTestHost(configuration.testHost.loanGuid, scenario).bridge;
}
