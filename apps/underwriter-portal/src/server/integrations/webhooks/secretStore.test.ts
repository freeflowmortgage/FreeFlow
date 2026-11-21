import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { createWebhookSecretStore, WebhookSecretStoreError } from './secretStore';
import { isSigningSecret } from './signing';

const TENANT = 'a7000000-0000-4000-8000-000000000001';
const ENDPOINT = 'a7000000-0000-4000-8000-000000000005';
const ARN = `arn:aws:secretsmanager:us-west-2:123456789012:secret:freeflow-dev/outbound-webhooks/${TENANT}/${ENDPOINT}-AbCdEf`;
const SEED = 'local-development-seed-with-at-least-32-chars';

test('protected runtimes refuse the local store and require a Secrets Manager prefix', () => {
  for (const env of [
    { FREEFLOW_RUNTIME_ENV: 'production', OUTBOUND_WEBHOOK_LOCAL_SIGNING_SEED: SEED },
    { FREEFLOW_RUNTIME_ENV: 'development' },
    { FREEFLOW_RUNTIME_ENV: 'development', OUTBOUND_WEBHOOK_LOCAL_SIGNING_SEED: 'short' },
    { OUTBOUND_WEBHOOK_SECRET_PREFIX: 'bad prefix' },
    { OUTBOUND_WEBHOOK_SECRET_PREFIX: 'freeflow-dev/outbound-webhooks/' },
  ]) {
    assert.throws(() => createWebhookSecretStore(env as unknown as NodeJS.ProcessEnv), WebhookSecretStoreError);
  }
});

test('the local development store derives stable per-version secrets and exposes the previous one', async () => {
  const store = createWebhookSecretStore({ FREEFLOW_RUNTIME_ENV: 'development', OUTBOUND_WEBHOOK_LOCAL_SIGNING_SEED: SEED } as unknown as NodeJS.ProcessEnv);
  const created = await store.create({ tenantId: TENANT, endpointId: ENDPOINT });
  assert.equal(created.reference, `local-dev:${TENANT}/${ENDPOINT}`);
  assert.ok(isSigningSecret(created.secret));
  assert.deepEqual(await store.read({ reference: created.reference, version: 1, includePrevious: true }), {
    current: created.secret,
    previous: null,
  });
  const rotated = await store.rotate({ reference: created.reference, nextVersion: 2 });
  assert.notEqual(rotated, created.secret);
  assert.deepEqual(await store.read({ reference: created.reference, version: 2, includePrevious: true }), {
    current: rotated,
    previous: created.secret,
  });
  await assert.rejects(store.read({ reference: ARN, version: 1, includePrevious: false }), WebhookSecretStoreError);
});

test('the Secrets Manager store creates, rotates, and reads by reference without keeping values', async () => {
  const commands: unknown[] = [];
  const values = new Map<string, string>();
  const client = {
    send: async (command: unknown) => {
      commands.push(command);
      if (command instanceof CreateSecretCommand) {
        values.set('AWSCURRENT', command.input.SecretString!);
        return { ARN };
      }
      if (command instanceof PutSecretValueCommand) {
        values.set('AWSPREVIOUS', values.get('AWSCURRENT')!);
        values.set('AWSCURRENT', command.input.SecretString!);
        return {};
      }
      if (command instanceof GetSecretValueCommand) {
        const value = values.get(command.input.VersionStage!);
        if (!value) throw new ResourceNotFoundException({ message: 'missing', $metadata: {} });
        return { SecretString: value };
      }
      throw new Error('unexpected command');
    },
  };
  const store = createWebhookSecretStore({
    FREEFLOW_RUNTIME_ENV: 'production',
    OUTBOUND_WEBHOOK_SECRET_PREFIX: 'freeflow-dev/outbound-webhooks',
    OUTBOUND_WEBHOOK_SECRET_KMS_KEY_ID: 'alias/freeflow-dev-secrets',
  } as unknown as NodeJS.ProcessEnv, client as never);

  const created = await store.create({ tenantId: TENANT, endpointId: ENDPOINT });
  assert.equal(created.reference, ARN);
  const create = commands[0] as CreateSecretCommand;
  assert.equal(create.input.Name, `freeflow-dev/outbound-webhooks/${TENANT}/${ENDPOINT}`);
  assert.equal(create.input.KmsKeyId, 'alias/freeflow-dev-secrets');
  assert.deepEqual(await store.read({ reference: ARN, version: 1, includePrevious: true }), { current: created.secret, previous: null });

  const rotated = await store.rotate({ reference: ARN, nextVersion: 2 });
  assert.deepEqual(await store.read({ reference: ARN, version: 2, includePrevious: true }), { current: rotated, previous: created.secret });
  assert.deepEqual(await store.read({ reference: ARN, version: 2, includePrevious: false }), { current: rotated, previous: null });
  await assert.rejects(store.rotate({ reference: `local-dev:${TENANT}/${ENDPOINT}`, nextVersion: 2 }), WebhookSecretStoreError);

  values.set('AWSCURRENT', 'not-a-webhook-secret');
  await assert.rejects(
    store.read({ reference: ARN, version: 2, includePrevious: false }),
    (error: unknown) => error instanceof WebhookSecretStoreError && error.code === 'WEBHOOK_SECRET_UNAVAILABLE',
  );
});
