import { EncompassConnectorError } from './errors';

const FORBIDDEN_KEY = /^(clientid|clientsecret|instanceid|password|accesstoken|refreshtoken|apikey|authorization|credential|secret)$/i;

export function assertNoLosCredentials(value: unknown): void {
  walk(value);
}

function walk(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key.replace(/[_-]/g, ''))) {
      throw new EncompassConnectorError(
        'LOS_CREDENTIALS_FORBIDDEN',
        'Connector payloads must not include LOS credentials.',
        false,
      );
    }
    walk(child);
  }
}
