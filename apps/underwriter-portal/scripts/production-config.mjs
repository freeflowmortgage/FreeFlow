import { pathToFileURL } from 'node:url';

const NON_PRODUCTION_MODES = new Set(['development', 'test']);
const SUPPORTED_RUNTIME_MODES = new Set(['development', 'test', 'staging', 'production']);
const CORE_REQUIRED_VARIABLES = [
  'APP_BASE_URL',
  'TRUSTED_ORIGIN',
  'AWS_REGION',
  'DATABASE_URL',
  'DOC_PARSER_URL',
  'DOC_PARSER_SERVICE_URL',
  'APPRAISAL_PARSER_URL',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_AUDIENCE',
  'ALB_OIDC_SIGNER_ARN',
  'FIELD_ENCRYPTION_KEY',
  'SYNC_QUEUE_URL',
  'SYNC_DLQ_URL',
];
const PRODUCTION_INTEGRATION_VARIABLES = [
  'REDIS_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];
const FORBIDDEN_DEMO_FLAGS = [
  'ALLOW_DEMO_MODE',
  'ENABLE_DEMO_MODE',
  'ENABLE_FIXTURES',
  'ALLOW_TEXT_FIXTURES',
  'NEXT_PUBLIC_ENABLE_DEMO',
  'ALLOW_DEV_AUTH_BYPASS',
];
const PLACEHOLDER_PATTERN =
  /(?:replace[-_ ]?with|change[-_ ]?me|placeholder|dummy|mock|example\.com|_EXAMPLE|111122223333|secrets-manager:)/i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function value(env, name) {
  return typeof env[name] === 'string' ? env[name].trim() : '';
}

export function getRuntimeMode(env) {
  const explicit = value(env, 'FREEFLOW_RUNTIME_ENV').toLowerCase();
  if (explicit) return explicit;
  return value(env, 'NODE_ENV').toLowerCase() === 'production' ? 'production' : 'development';
}

function parseUrl(
  env,
  name,
  errors,
  protocols,
  { rejectLoopback = true, originOnly = false, allowCredentials = false } = {},
) {
  const raw = value(env, name);
  if (!raw) return undefined;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    errors.push(`${name} must be a valid absolute URL.`);
    return undefined;
  }

  if (!protocols.includes(parsed.protocol)) {
    errors.push(`${name} must use ${protocols.join(' or ')}.`);
  }
  if (rejectLoopback && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    errors.push(`${name} must not target a loopback or wildcard host.`);
  }
  if (!allowCredentials && (parsed.username || parsed.password)) {
    errors.push(`${name} must not contain URL credentials.`);
  }
  if (originOnly && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
    errors.push(`${name} must contain only an origin, without a path, query, or fragment.`);
  }
  return parsed;
}

function isEnabled(env, name) {
  return ['1', 'true', 'yes', 'on'].includes(value(env, name).toLowerCase());
}

export function validateProductionConfig(env) {
  const errors = [];
  const runtimeMode = getRuntimeMode(env);

  if (!SUPPORTED_RUNTIME_MODES.has(runtimeMode)) {
    errors.push('FREEFLOW_RUNTIME_ENV must be development, test, staging, or production.');
  }
  if (NON_PRODUCTION_MODES.has(runtimeMode)) return errors;
  if (value(env, 'NODE_ENV').toLowerCase() !== 'production') {
    errors.push('NODE_ENV must be production for staging and production runtimes.');
  }

  const requiredVariables = runtimeMode === 'production'
    ? [...CORE_REQUIRED_VARIABLES, ...PRODUCTION_INTEGRATION_VARIABLES]
    : CORE_REQUIRED_VARIABLES;
  for (const name of requiredVariables) {
    const raw = value(env, name);
    if (!raw) {
      errors.push(`${name} is required.`);
    } else if (PLACEHOLDER_PATTERN.test(raw)) {
      errors.push(`${name} contains a placeholder or mock value.`);
    }
  }
  for (const name of PRODUCTION_INTEGRATION_VARIABLES) {
    const raw = value(env, name);
    if (raw && PLACEHOLDER_PATTERN.test(raw)) {
      errors.push(`${name} contains a placeholder or mock value.`);
    }
  }

  for (const name of FORBIDDEN_DEMO_FLAGS) {
    if (isEnabled(env, name)) errors.push(`${name} must be disabled.`);
  }
  if (value(env, 'AWS_ACCESS_KEY_ID') || value(env, 'AWS_SECRET_ACCESS_KEY')) {
    errors.push('Static AWS access keys are forbidden; use the ECS task role.');
  }

  parseUrl(env, 'APP_BASE_URL', errors, ['https:'], { originOnly: true });
  parseUrl(env, 'TRUSTED_ORIGIN', errors, ['https:'], { originOnly: true });
  parseUrl(env, 'DOC_PARSER_URL', errors, ['http:', 'https:']);
  parseUrl(env, 'DOC_PARSER_SERVICE_URL', errors, ['http:', 'https:']);
  parseUrl(env, 'APPRAISAL_PARSER_URL', errors, ['http:', 'https:']);
  parseUrl(env, 'OIDC_ISSUER', errors, ['https:']);
  parseUrl(env, 'SYNC_QUEUE_URL', errors, ['https:']);
  parseUrl(env, 'SYNC_DLQ_URL', errors, ['https:']);

  const databaseUrl = parseUrl(env, 'DATABASE_URL', errors, ['postgres:', 'postgresql:'], {
    allowCredentials: true,
  });
  if (databaseUrl?.username.toLowerCase() === 'postgres') {
    errors.push('DATABASE_URL must use a restricted application role, not postgres.');
  }
  parseUrl(env, 'REDIS_URL', errors, ['rediss:'], { allowCredentials: true });

  if (value(env, 'APP_BASE_URL') && value(env, 'TRUSTED_ORIGIN')) {
    try {
      if (new URL(value(env, 'APP_BASE_URL')).origin !== new URL(value(env, 'TRUSTED_ORIGIN')).origin) {
        errors.push('TRUSTED_ORIGIN must match APP_BASE_URL origin.');
      }
    } catch {
      // The individual URL errors above are more useful.
    }
  }
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(value(env, 'AWS_REGION'))) {
    errors.push('AWS_REGION is not a valid AWS region identifier.');
  }
  if (!/^arn:aws(?:-us-gov)?:elasticloadbalancing:[^:]+:\d{12}:loadbalancer\/app\//.test(value(env, 'ALB_OIDC_SIGNER_ARN'))) {
    errors.push('ALB_OIDC_SIGNER_ARN must be an application load balancer ARN.');
  }
  if (value(env, 'OIDC_CLIENT_ID') && value(env, 'OIDC_AUDIENCE') !== value(env, 'OIDC_CLIENT_ID')) {
    errors.push('OIDC_AUDIENCE must match OIDC_CLIENT_ID for ALB-signed user claims.');
  }
  if ((runtimeMode === 'production' || value(env, 'STRIPE_SECRET_KEY')) && !value(env, 'STRIPE_SECRET_KEY').startsWith('sk_live_')) {
    errors.push('STRIPE_SECRET_KEY must be a Stripe live-mode secret key.');
  }
  if ((runtimeMode === 'production' || value(env, 'STRIPE_WEBHOOK_SECRET')) && !value(env, 'STRIPE_WEBHOOK_SECRET').startsWith('whsec_')) {
    errors.push('STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret.');
  }
  if (value(env, 'FIELD_ENCRYPTION_KEY').length < 32) {
    errors.push('FIELD_ENCRYPTION_KEY must contain at least 32 characters.');
  }
  if (value(env, 'SYNC_QUEUE_URL') && value(env, 'SYNC_QUEUE_URL') === value(env, 'SYNC_DLQ_URL')) {
    errors.push('SYNC_QUEUE_URL and SYNC_DLQ_URL must identify different queues.');
  }

  return [...new Set(errors)];
}

export function assertProductionConfig(env = process.env) {
  const errors = validateProductionConfig(env);
  if (errors.length === 0) return;

  throw new Error(`FreeFlow refused to start because production configuration is unsafe:\n- ${errors.join('\n- ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertProductionConfig(process.env);
    console.log(`FreeFlow configuration accepted for ${getRuntimeMode(process.env)} runtime.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'FreeFlow production configuration is invalid.');
    process.exitCode = 1;
  }
}
