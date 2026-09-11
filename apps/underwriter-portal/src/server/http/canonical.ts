import { createHash } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Audit hash input must contain finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  throw new Error('Audit hash input must be JSON-compatible.');
}
