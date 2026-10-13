import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { COMPANY, NOTICES, noticeFor } from './legal/notices';
import { LEGAL_SLUGS, legalSlugFromHash } from './legalRoute';

test('a legal hash resolves with or without the leading marker', () => {
  assert.equal(legalSlugFromHash('#legal'), 'legal');
  assert.equal(legalSlugFromHash('terms'), 'terms');
  assert.equal(legalSlugFromHash('#privacy'), 'privacy');
});

test('a hash that is not a notice resolves to nothing', () => {
  for (const hash of ['', '#', '#workspace', '#split-doc', '#demo-income', '#legalese', '#Privacy']) {
    assert.equal(legalSlugFromHash(hash), null, `${hash} should not open a notice`);
  }
});

test('every advertised slug has a notice behind it', () => {
  for (const slug of LEGAL_SLUGS) {
    assert.equal(noticeFor(slug).slug, slug);
  }
  assert.deepEqual([...LEGAL_SLUGS].sort(), NOTICES.map((notice) => notice.slug).sort());
});

/**
 * The demo build mounts App and the protected build mounts ProtectedApp. The
 * landing footer links to the notices from both, so a notice that only one
 * entry point routes is a dead link in whichever build ships.
 */
test('both entry points route the notices the landing footer links to', () => {
  const footer = readFileSync(new URL('./components/B2BLanding.tsx', import.meta.url), 'utf8');
  const linked = [...footer.matchAll(/href="#([a-z-]+)"/g)].map((match) => match[1]);
  const linkedNotices = linked.filter((hash) => legalSlugFromHash(hash));
  assert.deepEqual(linkedNotices.sort(), ['legal', 'privacy', 'terms']);

  for (const entry of ['./App.tsx', './ProtectedApp.tsx']) {
    const source = readFileSync(new URL(entry, import.meta.url), 'utf8');
    assert.match(source, /legalSlugFromHash/, `${entry} must resolve legal hashes`);
    assert.match(source, /<LegalPage/, `${entry} must render the notice`);
    assert.match(source, /addEventListener\('hashchange'/, `${entry} must react to the footer links`);
  }
});

test('the notices carry the registered company details', () => {
  assert.equal(COMPANY.legalName, 'FreeFlow Mortgage Solutions LLC');
  assert.equal(COMPANY.governingState, 'Arizona');
  assert.match(COMPANY.governingVenue, /Maricopa County, Arizona/);
  assert.equal(COMPANY.privacyPhone, '(844) 356-1181');
  assert.match(COMPANY.entity, /Arizona limited liability company/);
});

test('the CCPA request channels name both the inbox and the phone line', () => {
  const rights = noticeFor('privacy').sections.find((section) => section.id === 'ca-rights');
  assert.ok(rights, 'the privacy notice must keep its California rights section');
  const prose = rights.blocks.flatMap((block) => (block.kind === 'p' ? [block.text] : [])).join(' ');
  assert.match(prose, /privacy@freeflowmortgage\.com/);
  assert.match(prose, /\(844\) 356-1181/);
});

/**
 * Arizona governing law sits beside a notice that grants California rights, so
 * the terms have to say plainly that the one does not displace the other.
 */
test('the governing law section preserves non-waivable resident rights', () => {
  const general = noticeFor('terms').sections.find((section) => section.id === 'general');
  assert.ok(general, 'the terms must keep a governing law section');
  const prose = general.blocks.flatMap((block) => (block.kind === 'p' ? [block.text] : [])).join(' ');
  assert.match(prose, /Arizona/);
  assert.match(prose, /cannot be waived by agreement/);
  assert.match(prose, /California rights/);
});

/**
 * A placeholder that reaches production reads as though it were the notice.
 * Only the service-of-process street address is still outstanding; if another
 * one appears, it has to be deliberate.
 */
test('only the postal address is still outstanding', () => {
  const outstanding = Object.entries(COMPANY)
    .filter(([, value]) => typeof value === 'string' && value.includes('TO BE COMPLETED'))
    .map(([key]) => key);
  assert.deepEqual(outstanding, ['address']);
});
