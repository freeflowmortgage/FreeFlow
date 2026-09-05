import assert from 'node:assert/strict';
import test from 'node:test';
import { getRuntimeMode, validateProductionConfig } from './production-config.mjs';

function validProductionEnv() {
  return {
    NODE_ENV: 'production',
    FREEFLOW_RUNTIME_ENV: 'production',
    APP_BASE_URL: 'https://app.freeflowmortgage.com',
    TRUSTED_ORIGIN: 'https://app.freeflowmortgage.com',
    AWS_REGION: 'us-east-1',
    DATABASE_URL: 'postgresql://freeflow_app:strong-password@database.internal:5432/freeflow',
    REDIS_URL: 'rediss://cache.internal:6379',
    DOC_PARSER_URL: 'http://income-parser.internal:8080/api/underwrite/process',
    DOC_PARSER_SERVICE_URL: 'http://income-parser.internal:8080/parse',
    APPRAISAL_PARSER_URL: 'http://appraisal-parser.internal:8081',
    OIDC_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_a1b2c3d4',
    OIDC_CLIENT_ID: '4exampleclientid9',
    OIDC_AUDIENCE: '4exampleclientid9',
    ALB_OIDC_SIGNER_ARN:
      'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/freeflow/abc123',
    ENCOMPASS_BASE_URL: 'https://api.elliemae.com',
    ENCOMPASS_CLIENT_ID: 'production-client-id',
    ENCOMPASS_CLIENT_SECRET: 'a-real-secret-with-sufficient-length',
    STRIPE_SECRET_KEY: 'sk_live_validproductionkey',
    STRIPE_WEBHOOK_SECRET: 'whsec_validproductionsecret',
    FIELD_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    SYNC_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/freeflow-sync',
    SYNC_DLQ_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/freeflow-sync-dlq',
  };
}

test('development mode does not require production credentials', () => {
  assert.equal(getRuntimeMode({ NODE_ENV: 'production', FREEFLOW_RUNTIME_ENV: 'development' }), 'development');
  assert.deepEqual(
    validateProductionConfig({ NODE_ENV: 'production', FREEFLOW_RUNTIME_ENV: 'development' }),
    [],
  );
});

test('a complete production environment is accepted', () => {
  assert.deepEqual(validateProductionConfig(validProductionEnv()), []);
});

test('missing values and placeholders fail closed without exposing values', () => {
  const env = validProductionEnv();
  delete env.OIDC_AUDIENCE;
  env.ENCOMPASS_CLIENT_SECRET = 'replace-with-secret';

  const errors = validateProductionConfig(env);
  assert.ok(errors.includes('OIDC_AUDIENCE is required.'));
  assert.ok(errors.includes('ENCOMPASS_CLIENT_SECRET contains a placeholder or mock value.'));
  assert.ok(errors.every((error) => !error.includes('replace-with-secret')));
});

test('loopback dependencies, static AWS keys, and demo flags are rejected', () => {
  const env = validProductionEnv();
  env.DOC_PARSER_URL = 'http://127.0.0.1:8080/parse';
  env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
  env.AWS_SECRET_ACCESS_KEY = 'not-logged';
  env.ENABLE_FIXTURES = 'true';
  env.ALLOW_DEV_AUTH_BYPASS = 'true';

  const errors = validateProductionConfig(env);
  assert.ok(errors.includes('DOC_PARSER_URL must not target a loopback or wildcard host.'));
  assert.ok(errors.includes('Static AWS access keys are forbidden; use the ECS task role.'));
  assert.ok(errors.includes('ENABLE_FIXTURES must be disabled.'));
  assert.ok(errors.includes('ALLOW_DEV_AUTH_BYPASS must be disabled.'));
});

test('owner database roles, plaintext Redis, and test Stripe keys are rejected', () => {
  const env = validProductionEnv();
  env.DATABASE_URL = 'postgresql://postgres:password@database.internal:5432/freeflow';
  env.REDIS_URL = 'redis://cache.internal:6379';
  env.STRIPE_SECRET_KEY = 'sk_test_not-production';

  const errors = validateProductionConfig(env);
  assert.ok(errors.includes('DATABASE_URL must use a restricted application role, not postgres.'));
  assert.ok(errors.includes('REDIS_URL must use rediss:.'));
  assert.ok(errors.includes('STRIPE_SECRET_KEY must be a Stripe live-mode secret key.'));
});
