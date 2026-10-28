import { createHmac } from 'node:crypto';
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { isProtectedRuntime } from '../../runtimeMode';
import { generateSigningSecret, isSigningSecret } from './signing';

export type SigningSecrets = Readonly<{ current: string; previous: string | null }>;

export type WebhookSecretStore = Readonly<{
  create(input: Readonly<{ tenantId: string; endpointId: string }>): Promise<{ reference: string; secret: string }>;
  rotate(input: Readonly<{ reference: string; nextVersion: number }>): Promise<string>;
  read(input: Readonly<{ reference: string; version: number; includePrevious: boolean }>): Promise<SigningSecrets>;
}>;

export class WebhookSecretStoreError extends Error {
  constructor(readonly code: 'WEBHOOK_SECRETS_UNCONFIGURED' | 'WEBHOOK_SECRET_UNAVAILABLE' | 'WEBHOOK_SECRET_REFERENCE_INVALID') {
    super(code);
    this.name = 'WebhookSecretStoreError';
  }
}

const SECRET_PREFIX = /^[A-Za-z0-9/_+=.@-]{1,200}$/;
const SECRETS_MANAGER_ARN = /^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,400}$/;
const LOCAL_REFERENCE = /^local-dev:[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/**
 * Selects Secrets Manager whenever a prefix is configured. The derived local
 * store exists only so developers can run the flow without AWS; it is refused
 * in protected runtimes.
 */
export function createWebhookSecretStore(
  env: NodeJS.ProcessEnv = process.env,
  client?: Pick<SecretsManagerClient, 'send'>,
): WebhookSecretStore {
  const prefix = env.OUTBOUND_WEBHOOK_SECRET_PREFIX?.trim();
  if (prefix) {
    if (!SECRET_PREFIX.test(prefix) || prefix.endsWith('/')) {
      throw new WebhookSecretStoreError('WEBHOOK_SECRETS_UNCONFIGURED');
    }
    return createSecretsManagerStore(prefix, env.OUTBOUND_WEBHOOK_SECRET_KMS_KEY_ID?.trim() || undefined, client);
  }
  const seed = env.OUTBOUND_WEBHOOK_LOCAL_SIGNING_SEED?.trim();
  if (!isProtectedRuntime(env) && seed && seed.length >= 32) return createLocalDevelopmentStore(seed);
  throw new WebhookSecretStoreError('WEBHOOK_SECRETS_UNCONFIGURED');
}

function createSecretsManagerStore(
  prefix: string,
  kmsKeyId: string | undefined,
  injected?: Pick<SecretsManagerClient, 'send'>,
): WebhookSecretStore {
  let client = injected;
  const secretsManager = () => {
    client ??= new SecretsManagerClient({});
    return client;
  };

  const readStage = async (reference: string, stage: 'AWSCURRENT' | 'AWSPREVIOUS'): Promise<string | null> => {
    try {
      const response = await secretsManager().send(new GetSecretValueCommand({ SecretId: reference, VersionStage: stage }));
      const value = response.SecretString;
      if (!value || !isSigningSecret(value)) throw new WebhookSecretStoreError('WEBHOOK_SECRET_UNAVAILABLE');
      return value;
    } catch (error) {
      if (stage === 'AWSPREVIOUS' && error instanceof ResourceNotFoundException) return null;
      if (error instanceof WebhookSecretStoreError) throw error;
      throw new WebhookSecretStoreError('WEBHOOK_SECRET_UNAVAILABLE');
    }
  };

  return Object.freeze({
    async create({ tenantId, endpointId }) {
      const secret = generateSigningSecret();
      let arn: string | undefined;
      try {
        const response = await secretsManager().send(new CreateSecretCommand({
          Name: `${prefix}/${tenantId}/${endpointId}`,
          Description: 'FreeFlow outbound webhook signing secret',
          SecretString: secret,
          ...(kmsKeyId ? { KmsKeyId: kmsKeyId } : {}),
          Tags: [
            { Key: 'freeflow:purpose', Value: 'outbound-webhook-signing' },
            { Key: 'freeflow:tenant', Value: tenantId },
          ],
        }));
        arn = response.ARN;
      } catch {
        throw new WebhookSecretStoreError('WEBHOOK_SECRET_UNAVAILABLE');
      }
      if (!arn || !SECRETS_MANAGER_ARN.test(arn)) throw new WebhookSecretStoreError('WEBHOOK_SECRET_UNAVAILABLE');
      return { reference: arn, secret };
    },
    async rotate({ reference }) {
      if (!SECRETS_MANAGER_ARN.test(reference)) throw new WebhookSecretStoreError('WEBHOOK_SECRET_REFERENCE_INVALID');
      const secret = generateSigningSecret();
      try {
        await secretsManager().send(new PutSecretValueCommand({ SecretId: reference, SecretString: secret }));
      } catch {
        throw new WebhookSecretStoreError('WEBHOOK_SECRET_UNAVAILABLE');
      }
      return secret;
    },
    async read({ reference, includePrevious }) {
      if (!SECRETS_MANAGER_ARN.test(reference)) throw new WebhookSecretStoreError('WEBHOOK_SECRET_REFERENCE_INVALID');
      const current = await readStage(reference, 'AWSCURRENT');
      const previous = includePrevious ? await readStage(reference, 'AWSPREVIOUS') : null;
      return { current: current!, previous };
    },
  });
}

function createLocalDevelopmentStore(seed: string): WebhookSecretStore {
  const derive = (reference: string, version: number) => (
    `whsec_${createHmac('sha256', seed).update(`${reference}#${version}`).digest('base64url')}`
  );
  return Object.freeze({
    async create({ tenantId, endpointId }) {
      const reference = `local-dev:${tenantId}/${endpointId}`;
      return { reference, secret: derive(reference, 1) };
    },
    async rotate({ reference, nextVersion }) {
      if (!LOCAL_REFERENCE.test(reference)) throw new WebhookSecretStoreError('WEBHOOK_SECRET_REFERENCE_INVALID');
      return derive(reference, nextVersion);
    },
    async read({ reference, version, includePrevious }) {
      if (!LOCAL_REFERENCE.test(reference)) throw new WebhookSecretStoreError('WEBHOOK_SECRET_REFERENCE_INVALID');
      return {
        current: derive(reference, version),
        previous: includePrevious && version > 1 ? derive(reference, version - 1) : null,
      };
    },
  });
}
