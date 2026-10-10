const mode = process.env.VITE_FREEFLOW_RUNTIME_MODE || (process.env.NODE_ENV === 'production' ? 'protected-web' : 'demo');
if (!['demo', 'qa', 'protected-web', 'encompass-hosted'].includes(mode)) {
  throw new Error('FREEFLOW_CONSOLE_MODE_INVALID');
}
if (process.env.NODE_ENV === 'production' && !['protected-web', 'encompass-hosted'].includes(mode)) {
  throw new Error('FREEFLOW_CONSOLE_DEMO_MODE_FORBIDDEN_IN_PRODUCTION');
}
