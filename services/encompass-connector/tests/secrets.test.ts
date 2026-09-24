import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertNoLosCredentials } from '@mortgage-pos/encompass-connector-contract';
import type {
  ServiceAuthMaterial,
  ServiceTokenRecord,
  VerifiedServicePrincipal,
} from '../src/auth';
import type { TenantLenderBinding } from '../src/binding';

const FORBIDDEN_IDENTIFIERS = [
  'clientSecret',
  'clientId',
  'instanceId',
  'accessToken',
  'refreshToken',
  'apiKey',
  'password',
] as const;

type ForbiddenLosName = (typeof FORBIDDEN_IDENTIFIERS)[number];
type AssertNever<T extends never> = T;
type AuthKeys = keyof ServiceAuthMaterial | keyof VerifiedServicePrincipal | keyof ServiceTokenRecord;
type BindingKeys = keyof TenantLenderBinding;
type _AuthHasNoLos = AssertNever<Extract<AuthKeys, ForbiddenLosName>>;
type _BindingHasNoLos = AssertNever<Extract<BindingKeys, ForbiddenLosName>>;

const SERVICE_ROOT = path.resolve(__dirname, '..');

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(next);
    return entry.name.endsWith('.ts') ? [next] : [];
  });
}

test('auth and binding modules do not declare LOS credential identifiers', () => {
  const files = [
    ...listTsFiles(path.join(SERVICE_ROOT, 'src/auth')),
    ...listTsFiles(path.join(SERVICE_ROOT, 'src/binding')),
  ];
  assert.ok(files.length >= 4, 'expected auth and binding source files');

  const pattern = new RegExp(`\\b(${FORBIDDEN_IDENTIFIERS.join('|')})\\b`);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const match = source.match(pattern);
    assert.equal(match, null, `${path.relative(SERVICE_ROOT, file)} must not mention ${match?.[1]}`);
  }
});

test('connector and HTTP modules do not persist PDF bytes to disk or object storage', () => {
  const persistPattern = /\b(writeFile|writeFileSync|createWriteStream|PutObject|upload\(|S3Client|@aws-sdk\/client-s3)\b/;
  const files = [
    ...listTsFiles(path.join(SERVICE_ROOT, 'src/connector')),
    ...listTsFiles(path.join(SERVICE_ROOT, 'src/http')),
  ];
  assert.ok(files.length >= 2);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const match = source.match(persistPattern);
    assert.equal(match, null, `${path.relative(SERVICE_ROOT, file)} must not persist bytes via ${match?.[1]}`);
  }
});

test('auth and binding sample objects contain no LOS credential fields', () => {
  const principal: VerifiedServicePrincipal = { serviceId: 'portal', tenantId: 'tenant-a' };
  const material: ServiceAuthMaterial = { authorizationHeader: 'Bearer svc' };
  const token: ServiceTokenRecord = { token: 'svc', serviceId: 'portal', tenantId: 'tenant-a' };
  const binding: TenantLenderBinding = {
    tenantId: 'tenant-a',
    lenderId: 'lender-a',
    deploymentId: 'deploy-a',
  };

  for (const value of [principal, material, token, binding]) {
    assertNoLosCredentials(value);
    for (const key of FORBIDDEN_IDENTIFIERS) {
      assert.equal(key in value, false);
    }
  }

  const unused: [_AuthHasNoLos, _BindingHasNoLos] | undefined = undefined;
  assert.equal(unused, undefined);
});
