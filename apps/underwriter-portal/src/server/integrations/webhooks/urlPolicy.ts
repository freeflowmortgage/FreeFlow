import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { sha256Hex } from '../../http/canonical';
import { isProtectedRuntime } from '../../runtimeMode';

export const MAX_WEBHOOK_URL_LENGTH = 2040;

export class WebhookPolicyError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean = false,
  ) {
    super(code);
    this.name = 'WebhookPolicyError';
  }
}

export type WebhookEgressPolicy = Readonly<{
  protectedRuntime: boolean;
  allowedHosts: readonly string[];
  allowPrivateTargets: boolean;
}>;

export type ResolvedWebhookAddress = Readonly<{ address: string; family: 4 | 6 }>;

export type HostLookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

const HOST_PATTERN = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/**
 * Reads the deployment's outbound rules. Protected runtimes must name every
 * customer host explicitly and can never reach private address space.
 */
export function readWebhookEgressPolicy(env: NodeJS.ProcessEnv = process.env): WebhookEgressPolicy {
  const protectedRuntime = isProtectedRuntime(env);
  const allowPrivateTargets = env.OUTBOUND_WEBHOOK_ALLOW_PRIVATE_TARGETS?.trim() === 'true';
  if (protectedRuntime && allowPrivateTargets) {
    throw new WebhookPolicyError('WEBHOOK_PRIVATE_TARGETS_FORBIDDEN');
  }
  const allowedHosts = (env.OUTBOUND_WEBHOOK_ALLOWED_HOSTS ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  for (const host of allowedHosts) {
    if (!HOST_PATTERN.test(host)) throw new WebhookPolicyError('WEBHOOK_HOST_ALLOWLIST_INVALID');
  }
  return Object.freeze({ protectedRuntime, allowedHosts: Object.freeze(allowedHosts), allowPrivateTargets });
}

export function parseWebhookUrl(raw: unknown, policy: WebhookEgressPolicy): URL {
  if (typeof raw !== 'string') throw new WebhookPolicyError('WEBHOOK_URL_INVALID');
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_WEBHOOK_URL_LENGTH || /\s/.test(trimmed)) {
    throw new WebhookPolicyError('WEBHOOK_URL_INVALID');
  }
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new WebhookPolicyError('WEBHOOK_URL_INVALID'); }
  if (url.protocol !== 'https:') throw new WebhookPolicyError('WEBHOOK_URL_HTTPS_REQUIRED');
  if (url.username || url.password) throw new WebhookPolicyError('WEBHOOK_URL_CREDENTIALS_FORBIDDEN');
  if (url.search || url.hash || trimmed.includes('?') || trimmed.includes('#')) {
    throw new WebhookPolicyError('WEBHOOK_URL_QUERY_FORBIDDEN');
  }
  if (!url.hostname) throw new WebhookPolicyError('WEBHOOK_URL_INVALID');
  if (policy.protectedRuntime && url.port && url.port !== '443') {
    throw new WebhookPolicyError('WEBHOOK_URL_PORT_FORBIDDEN');
  }
  if (url.href.length > MAX_WEBHOOK_URL_LENGTH) throw new WebhookPolicyError('WEBHOOK_URL_INVALID');

  const literal = unbracket(url.hostname);
  if (isIP(literal)) {
    if (policy.protectedRuntime) throw new WebhookPolicyError('WEBHOOK_URL_IP_LITERAL_FORBIDDEN');
    if (!policy.allowPrivateTargets && isForbiddenAddress(literal)) {
      throw new WebhookPolicyError('WEBHOOK_DESTINATION_FORBIDDEN');
    }
  }
  if (!isHostAllowed(url.hostname, policy)) throw new WebhookPolicyError('WEBHOOK_HOST_NOT_ALLOWED');
  return url;
}

export function isHostAllowed(hostname: string, policy: WebhookEgressPolicy): boolean {
  const host = hostname.toLowerCase();
  if (policy.allowedHosts.length === 0) return !policy.protectedRuntime;
  return policy.allowedHosts.some((entry) => (
    entry.startsWith('*.') ? host.endsWith(entry.slice(1)) && host.length > entry.length - 1 : host === entry
  ));
}

/**
 * Resolves every address for the host and refuses the delivery if any of them
 * is internal. The caller must connect to the returned address so a second DNS
 * answer cannot redirect the request after validation.
 */
export async function resolveWebhookAddress(
  url: URL,
  policy: WebhookEgressPolicy,
  lookup: HostLookup = defaultLookup,
): Promise<ResolvedWebhookAddress> {
  const literal = unbracket(url.hostname);
  const literalFamily = isIP(literal);
  if (literalFamily) {
    if (!policy.allowPrivateTargets && isForbiddenAddress(literal)) {
      throw new WebhookPolicyError('WEBHOOK_DESTINATION_FORBIDDEN');
    }
    return { address: literal, family: literalFamily as 4 | 6 };
  }

  let addresses: readonly { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname);
  } catch {
    throw new WebhookPolicyError('WEBHOOK_DNS_RESOLUTION_FAILED', true);
  }
  if (addresses.length === 0) throw new WebhookPolicyError('WEBHOOK_DNS_RESOLUTION_FAILED', true);
  if (!policy.allowPrivateTargets && addresses.some((entry) => isForbiddenAddress(entry.address))) {
    throw new WebhookPolicyError('WEBHOOK_DESTINATION_FORBIDDEN');
  }
  const selected = addresses[0]!;
  const family = isIP(selected.address);
  if (family !== 4 && family !== 6) throw new WebhookPolicyError('WEBHOOK_DNS_RESOLUTION_FAILED', true);
  return { address: selected.address, family };
}

const FORBIDDEN_V4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) FORBIDDEN_V4.addSubnet(network, prefix, 'ipv4');

const FORBIDDEN_V6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8],
] as const) FORBIDDEN_V6.addSubnet(network, prefix, 'ipv6');

export function isForbiddenAddress(address: string): boolean {
  const value = unbracket(address).toLowerCase();
  const family = isIP(value);
  if (family === 4) return FORBIDDEN_V4.check(value, 'ipv4');
  if (family !== 6) return true;
  const mapped = embeddedIpv4(value);
  if (mapped) return FORBIDDEN_V4.check(mapped, 'ipv4');
  return FORBIDDEN_V6.check(value, 'ipv6');
}

export function webhookUrlHost(url: URL): string {
  return url.host.toLowerCase();
}

export function hashWebhookUrl(url: URL): string {
  return sha256Hex(url.href);
}

function embeddedIpv4(ipv6: string): string | null {
  const dotted = /^::(?:ffff:(?:0:)?)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ipv6);
  if (dotted) return dotted[1]!;
  const hex = /^::(?:ffff:(?:0:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ipv6);
  if (!hex) return null;
  const high = Number.parseInt(hex[1]!, 16);
  const low = Number.parseInt(hex[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

async function defaultLookup(hostname: string) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}
