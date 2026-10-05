const SALES_ORIGIN = 'https://dev.freeflowmortgage.com';
const APP_ORIGIN = 'https://app.dev.freeflowmortgage.com';

/**
 * Encompass-hosted CSP lists explicit frame ancestors. When that list already
 * names the freeflow-dev sales host, also allow the software-entry host.
 * Other ancestor lists, including `'none'`, are left unchanged.
 */
export function frameAncestorsForDevPortal(ancestors) {
  const entries = ancestors.split(/\s+/).filter(Boolean);
  if (entries.includes(SALES_ORIGIN) && !entries.includes(APP_ORIGIN)) {
    return [...entries, APP_ORIGIN].join(' ');
  }
  return ancestors;
}
