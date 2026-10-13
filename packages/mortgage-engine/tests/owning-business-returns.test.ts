/**
 * Attributing a balance sheet to the return it was printed in.
 *
 * The classifier labels page 1 of a return with its masthead and labels the
 * balance sheet `Schedule L`. Nothing on the Schedule L page names the return,
 * so the console used to look for a "1065" label on the page itself and never
 * found one, and the only thing keeping Schedule L alive was a fallback that
 * gave up as soon as the packet held two businesses.
 */
import { owningBusinessReturns } from '../../../apps/underwriting-console/src/liveHydrate';

/** Page labels as the splitter emits them for the official blanks. */
const PARTNERSHIP_RETURN = [
  ['Form 1065 (Partnership Return)', 'Form 4562 (Depreciation)'],
  ['Schedule K-1'],
  [],
  [],
  ['Form 4562 (Depreciation)'],
  ['Schedule L', 'Schedule M-1', 'Schedule M-2'],
];

const SCORP_RETURN = [
  ['Form 1120S (S-Corporation Return)', 'Form 4562 (Depreciation)'],
  [],
  ['Form 4562 (Depreciation)'],
  ['Schedule L'],
  ['Schedule M-1', 'Schedule M-2'],
];

const CCORP_RETURN = [
  ['Form 1120 (C-Corporation Return)', 'Form 4562 (Depreciation)'],
  [],
  [],
  [],
  [],
  ['Schedule L', 'Schedule M-1', 'Schedule M-2'],
];

function pagesOf(documentId: string, labels: string[][], startAt = 0) {
  return labels.map((formIds, offset) => ({ documentId, index: startAt + offset, formIds }));
}

describe('owningBusinessReturns', () => {
  it('carries the masthead forward to the balance sheet five pages later', () => {
    const owners = owningBusinessReturns(pagesOf('doc-1065', PARTNERSHIP_RETURN));

    expect(owners.get('doc-1065:5')).toBe('Form 1065 (Partnership Return)');
    expect(owners.get('doc-1065:1')).toBe('Form 1065 (Partnership Return)');
  });

  it('tells two business returns in one packet apart', () => {
    const owners = owningBusinessReturns([
      ...pagesOf('doc-1065', PARTNERSHIP_RETURN),
      ...pagesOf('doc-1120s', SCORP_RETURN),
    ]);

    expect(owners.get('doc-1065:5')).toBe('Form 1065 (Partnership Return)');
    expect(owners.get('doc-1120s:3')).toBe('Form 1120S (S-Corporation Return)');
  });

  it('splits two returns concatenated into one file at the second masthead', () => {
    const owners = owningBusinessReturns([
      ...pagesOf('stack', PARTNERSHIP_RETURN),
      ...pagesOf('stack', SCORP_RETURN, PARTNERSHIP_RETURN.length),
    ]);

    expect(owners.get('stack:5')).toBe('Form 1065 (Partnership Return)');
    expect(owners.get('stack:9')).toBe('Form 1120S (S-Corporation Return)');
  });

  it('keeps an 1120 balance sheet off the 1120-S', () => {
    const owners = owningBusinessReturns([
      ...pagesOf('doc-1120', CCORP_RETURN),
      ...pagesOf('doc-1120s', SCORP_RETURN),
    ]);

    const ccorp = owners.get('doc-1120:5')!;
    expect(/form\s*1120(?!-?\s*s)\b|c-corporation/i.test(ccorp)).toBe(true);
    expect(/1120-?s/i.test(ccorp)).toBe(false);
    expect(/1120-?s/i.test(owners.get('doc-1120s:3')!)).toBe(true);
  });

  it('attributes nothing to pages ahead of the first masthead', () => {
    const owners = owningBusinessReturns([
      { documentId: 'doc', index: 0, formIds: ['Form 1040 (Individual Return)'] },
      { documentId: 'doc', index: 1, formIds: ['Schedule E (Page 2 - K-1s)'] },
      { documentId: 'doc', index: 2, formIds: ['Form 1065 (Partnership Return)'] },
      { documentId: 'doc', index: 3, formIds: ['Schedule L'] },
    ]);

    expect(owners.has('doc:0')).toBe(false);
    expect(owners.has('doc:1')).toBe(false);
    expect(owners.get('doc:3')).toBe('Form 1065 (Partnership Return)');
  });

  it('reads a document whose pages arrive out of order', () => {
    const owners = owningBusinessReturns([
      { documentId: 'doc', index: 5, formIds: ['Schedule L'] },
      { documentId: 'doc', index: 0, formIds: ['Form 1065 (Partnership Return)'] },
    ]);

    expect(owners.get('doc:5')).toBe('Form 1065 (Partnership Return)');
  });

  it('does not let one document\'s masthead claim the next document', () => {
    const owners = owningBusinessReturns([
      ...pagesOf('doc-1065', PARTNERSHIP_RETURN),
      { documentId: 'doc-loose', index: 0, formIds: ['Schedule L'] },
    ]);

    expect(owners.has('doc-loose:0')).toBe(false);
  });

  it('ignores a K-1 for the partnership it reports on', () => {
    const owners = owningBusinessReturns([
      { documentId: 'doc-k1', index: 0, formIds: ['Schedule K-1 (1065)'] },
    ]);

    expect(owners.size).toBe(0);
  });
});
