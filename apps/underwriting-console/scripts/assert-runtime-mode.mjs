// This script is part of the production build command. Local demo builds must
// opt in explicitly; an omitted mode must compile the standalone experience.
const mode = process.env.VITE_FREEFLOW_RUNTIME_MODE || 'protected-web';
if (!['demo', 'qa', 'protected-web', 'encompass-hosted'].includes(mode)) {
  throw new Error('FREEFLOW_CONSOLE_MODE_INVALID');
}
if (process.env.NODE_ENV === 'production' && !['protected-web', 'encompass-hosted'].includes(mode)) {
  throw new Error('FREEFLOW_CONSOLE_DEMO_MODE_FORBIDDEN_IN_PRODUCTION');
}
