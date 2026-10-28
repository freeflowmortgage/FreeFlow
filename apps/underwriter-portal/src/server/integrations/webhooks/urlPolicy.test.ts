import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isForbiddenAddress,
  parseWebhookUrl,
  readWebhookEgressPolicy,
  resolveWebhookAddress,
  WebhookPolicyError,
  type WebhookEgressPolicy,
} from './urlPolicy';

const PROTECTED: WebhookEgressPolicy = {
  protectedRuntime: true,
  allowedHosts: ['hooks.lender.example', '*.receiver.example'],
  allowPrivateTargets: false,
};
const DEVELOPMENT: WebhookEgressPolicy = { protectedRuntime: false, allowedHosts: [], allowPrivateTargets: false };

function rejects(raw: unknown, policy: WebhookEgressPolicy, code: string) {
  assert.throws(() => parseWebhookUrl(raw, policy), (error: unknown) => (
    error instanceof WebhookPolicyError && error.code === code
  ));
}

test('webhook URLs must be HTTPS without credentials, query strings, or fragments', () => {
  rejects('http://hooks.lender.example/freeflow', PROTECTED, 'WEBHOOK_URL_HTTPS_REQUIRED');
  rejects('https://user:pass@hooks.lender.example/freeflow', PROTECTED, 'WEBHOOK_URL_CREDENTIALS_FORBIDDEN');
  rejects('https://hooks.lender.example/freeflow?token=secret', PROTECTED, 'WEBHOOK_URL_QUERY_FORBIDDEN');
  rejects('https://hooks.lender.example/freeflow#frag', PROTECTED, 'WEBHOOK_URL_QUERY_FORBIDDEN');
  rejects('https://hooks.lender.example/?', PROTECTED, 'WEBHOOK_URL_QUERY_FORBIDDEN');
  rejects('not a url', PROTECTED, 'WEBHOOK_URL_INVALID');
  rejects(42, PROTECTED, 'WEBHOOK_URL_INVALID');
  rejects(`https://hooks.lender.example/${'a'.repeat(2050)}`, PROTECTED, 'WEBHOOK_URL_INVALID');
  assert.equal(parseWebhookUrl(' https://Hooks.Lender.Example/freeflow ', PROTECTED).href, 'https://hooks.lender.example/freeflow');
});

test('protected runtimes require the default port, a hostname, and an allowlisted host', () => {
  rejects('https://hooks.lender.example:8443/freeflow', PROTECTED, 'WEBHOOK_URL_PORT_FORBIDDEN');
  rejects('https://203.0.114.10/freeflow', PROTECTED, 'WEBHOOK_URL_IP_LITERAL_FORBIDDEN');
  rejects('https://other.example/freeflow', PROTECTED, 'WEBHOOK_HOST_NOT_ALLOWED');
  rejects('https://receiver.example/freeflow', PROTECTED, 'WEBHOOK_HOST_NOT_ALLOWED');
  rejects('https://evilreceiver.example/freeflow', PROTECTED, 'WEBHOOK_HOST_NOT_ALLOWED');
  assert.equal(parseWebhookUrl('https://a.receiver.example/hook', PROTECTED).hostname, 'a.receiver.example');
  assert.equal(parseWebhookUrl('https://hooks.lender.example:443/hook', PROTECTED).port, '');

  const unconfigured = { ...PROTECTED, allowedHosts: [] };
  rejects('https://hooks.lender.example/freeflow', unconfigured, 'WEBHOOK_HOST_NOT_ALLOWED');
});

test('development allows any public host and port but still refuses private literals by default', () => {
  assert.equal(parseWebhookUrl('https://localhost:9443/hook', DEVELOPMENT).port, '9443');
  rejects('https://127.0.0.1:9443/hook', DEVELOPMENT, 'WEBHOOK_DESTINATION_FORBIDDEN');
  rejects('https://[::1]:9443/hook', DEVELOPMENT, 'WEBHOOK_DESTINATION_FORBIDDEN');
  assert.equal(
    parseWebhookUrl('https://127.0.0.1:9443/hook', { ...DEVELOPMENT, allowPrivateTargets: true }).hostname,
    '127.0.0.1',
  );
});

test('egress policy refuses private targets and malformed allowlists in protected runtimes', () => {
  assert.throws(
    () => readWebhookEgressPolicy({ FREEFLOW_RUNTIME_ENV: 'production', OUTBOUND_WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true' } as unknown as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof WebhookPolicyError && error.code === 'WEBHOOK_PRIVATE_TARGETS_FORBIDDEN',
  );
  assert.throws(
    () => readWebhookEgressPolicy({ FREEFLOW_RUNTIME_ENV: 'production', OUTBOUND_WEBHOOK_ALLOWED_HOSTS: 'https://x.example' } as unknown as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof WebhookPolicyError && error.code === 'WEBHOOK_HOST_ALLOWLIST_INVALID',
  );
  assert.deepEqual(
    readWebhookEgressPolicy({ FREEFLOW_RUNTIME_ENV: 'production', OUTBOUND_WEBHOOK_ALLOWED_HOSTS: 'Hooks.Lender.Example, *.receiver.example' } as unknown as NodeJS.ProcessEnv),
    { protectedRuntime: true, allowedHosts: ['hooks.lender.example', '*.receiver.example'], allowPrivateTargets: false },
  );
  assert.equal(
    readWebhookEgressPolicy({ FREEFLOW_RUNTIME_ENV: 'development', OUTBOUND_WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true' } as unknown as NodeJS.ProcessEnv).allowPrivateTargets,
    true,
  );
});

test('internal, reserved, and metadata addresses are forbidden in IPv4, IPv6, and mapped forms', () => {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12:3456::1',
    'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::', 'not-an-ip',
  ]) {
    assert.equal(isForbiddenAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isForbiddenAddress(address), false, address);
  }
});

test('resolution rejects a host if any answer is internal and pins the first public answer', async () => {
  const url = new URL('https://hooks.lender.example/freeflow');
  await assert.rejects(
    resolveWebhookAddress(url, PROTECTED, async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]),
    (error: unknown) => error instanceof WebhookPolicyError && error.code === 'WEBHOOK_DESTINATION_FORBIDDEN' && !error.retryable,
  );
  await assert.rejects(
    resolveWebhookAddress(url, PROTECTED, async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); }),
    (error: unknown) => error instanceof WebhookPolicyError && error.code === 'WEBHOOK_DNS_RESOLUTION_FAILED' && error.retryable,
  );
  await assert.rejects(
    resolveWebhookAddress(url, PROTECTED, async () => []),
    (error: unknown) => error instanceof WebhookPolicyError && error.retryable,
  );
  assert.deepEqual(
    await resolveWebhookAddress(url, PROTECTED, async () => [
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '93.184.216.34', family: 4 },
    ]),
    { address: '2606:4700:4700::1111', family: 6 },
  );
  assert.deepEqual(
    await resolveWebhookAddress(new URL('https://localhost/hook'), { ...DEVELOPMENT, allowPrivateTargets: true }, async () => [
      { address: '127.0.0.1', family: 4 },
    ]),
    { address: '127.0.0.1', family: 4 },
  );
});
