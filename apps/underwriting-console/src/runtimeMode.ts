export type ConsoleRuntimeMode = 'demo' | 'qa' | 'protected';

export type ConsoleRuntime = Readonly<{
  mode: ConsoleRuntimeMode;
  demoEnabled: boolean;
  protected: boolean;
}>;

export function resolveConsoleRuntimeMode(
  value: string | undefined,
  options: Readonly<{ production: boolean }>,
): ConsoleRuntime {
  const mode = value ?? (options.production ? 'protected' : 'demo');
  if (mode !== 'demo' && mode !== 'qa' && mode !== 'protected') {
    throw new Error('FREEFLOW_CONSOLE_MODE_INVALID');
  }
  if (options.production && mode !== 'protected') {
    throw new Error('FREEFLOW_CONSOLE_DEMO_MODE_FORBIDDEN_IN_PRODUCTION');
  }
  return { mode, demoEnabled: mode === 'demo' || mode === 'qa', protected: mode === 'protected' };
}

const viteEnvironment = typeof import.meta.env === 'undefined' ? undefined : import.meta.env;
export const consoleRuntime = resolveConsoleRuntimeMode(viteEnvironment?.VITE_FREEFLOW_RUNTIME_MODE, {
  production: viteEnvironment?.PROD === true,
});
