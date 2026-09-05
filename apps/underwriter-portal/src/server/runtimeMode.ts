const NON_PRODUCTION_MODES = new Set(['development', 'test']);

export function isProtectedRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicitMode = env.FREEFLOW_RUNTIME_ENV?.trim().toLowerCase();
  if (explicitMode) return !NON_PRODUCTION_MODES.has(explicitMode);
  return env.NODE_ENV === 'production';
}
