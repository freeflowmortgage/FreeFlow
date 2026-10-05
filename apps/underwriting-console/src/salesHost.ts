/** freeflow-dev host split. The sales site and the signed-in product share one console build. */
export const SALES_HOSTNAME = 'dev.freeflowmortgage.com';
export const APP_HOSTNAME = 'app.dev.freeflowmortgage.com';
export const APP_ORIGIN = 'https://app.dev.freeflowmortgage.com';

/** Public in-browser income demo. Stays on `/` so it never enters the Cognito `/workspace` rule. */
export const PUBLIC_INCOME_DEMO_HASH = 'demo-income';

/**
 * Synthetic comparison PDFs for the public demo.
 * `/fixtures/*` stays Cognito-protected at the edge; this prefix is not on that rule.
 */
export const PUBLIC_DEMO_DOCUMENT_PREFIX = '/solo-demo/docs';

export function isSalesLandingHost(hostname: string): boolean {
  return hostname.toLowerCase() === SALES_HOSTNAME;
}

export function isSoftwareEntryHost(hostname: string): boolean {
  return hostname.toLowerCase() === APP_HOSTNAME;
}

export function isPublicIncomeDemoHash(hash: string): boolean {
  return hash.replace(/^#/, '') === PUBLIC_INCOME_DEMO_HASH;
}

export function appWorkspaceHref(view: string): string {
  return `${APP_ORIGIN}/workspace?product=${encodeURIComponent(view)}`;
}
