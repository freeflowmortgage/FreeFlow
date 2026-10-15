import type { LegalSlug } from './appTypes';

export const LEGAL_SLUGS: readonly LegalSlug[] = ['legal', 'terms', 'privacy'];

/**
 * The notice a hash asks for, or null when the hash is not a legal route.
 *
 * Shared by both entry points on purpose. The demo build mounts App and the
 * protected build mounts ProtectedApp, but the landing footer that links to
 * these notices renders in both, so both have to resolve the same hashes.
 */
export function legalSlugFromHash(hash: string): LegalSlug | null {
  const value = hash.replace(/^#/, '');
  return (LEGAL_SLUGS as readonly string[]).includes(value) ? (value as LegalSlug) : null;
}
