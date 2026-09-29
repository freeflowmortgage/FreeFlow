/**
 * Borrowers on the loan, and matching the person named on an income document
 * (W-2 box e, pay stub employee, K-1 partner or shareholder, Schedule C
 * proprietor) to one of them.
 */

export type BorrowerRole = 'Borrower' | 'CoBorrower';

export type LoanBorrower = {
  id: string;
  name: string;
  role: BorrowerRole;
  /** Read from the documents because no 1003 was loaded. */
  fromDocuments?: boolean;
};

export const PRIMARY_BORROWER_ID = 'borrower-1';

export function borrowerIdAt(index: number): string {
  return `borrower-${index + 1}`;
}

const NAME_SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'md', 'dds', 'cpa', 'esq']);

/** Lower-case name tokens with punctuation, suffixes and single initials removed. */
export function personNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2 && !NAME_SUFFIX.has(token));
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// OCR drops or swaps a letter in longer names; short names must match exactly
// so "Ann" and "Anna" stay different people.
function tokenMatches(want: string, have: string): boolean {
  if (want === have) return true;
  return want.length >= 5 && have.length >= 5 && editDistanceAtMostOne(want, have);
}

/**
 * True when the borrower's first and last name both appear in `text`, in any
 * order. `text` may carry an address or a second person ("Nathan Jenson and
 * Katherine Jenson"), so this is containment, not equality.
 */
export function namesPerson(text: string, personName: string): boolean {
  const want = personNameTokens(personName);
  if (!want.length) return false;
  const have = personNameTokens(text);
  const first = want[0];
  const last = want[want.length - 1];
  const hasFirst = have.some((token) => tokenMatches(first, token));
  const hasLast = have.some((token) => tokenMatches(last, token));
  return hasFirst && hasLast;
}

/** Two document names refer to the same person. */
export function samePerson(left: string, right: string): boolean {
  return namesPerson(left, right) || namesPerson(right, left);
}

/** Every borrower the text names. A joint return can name two. */
export function borrowersNamedIn(text: string | undefined, borrowers: LoanBorrower[]): LoanBorrower[] {
  if (!text?.trim()) return [];
  return borrowers.filter((borrower) => namesPerson(text, borrower.name));
}

/** A person name as it should be shown: the name line only, without the address that often follows. */
export function displayPersonName(raw: string): string {
  const line = raw.split(/\n/)[0] ?? raw;
  const beforeAddress = line.split(/\s+(?=\d)/)[0] ?? line;
  return beforeAddress.replace(/\s+/g, ' ').trim();
}

const NOT_A_PERSON =
  /\b(?:name|names|address|city|state|zip|code|partner|partnership|shareholder|corporation|employee|employer|instructions?|see|entered|initial|last|first|suff|identifying|number|ssn|tin|social|security|copy|form|llc|inc|corp|ltd|lp|llp|trust|estate|company|bank)\b/i;

/**
 * The person on a document, or undefined when the captured text is a form
 * caption or a business rather than a first-and-last name. A caption read as a
 * name would mark the borrower's own W-2 as someone else's.
 */
export function documentPersonName(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const name = displayPersonName(raw);
  if (NOT_A_PERSON.test(name)) return undefined;
  return personNameTokens(name).length >= 2 ? name : undefined;
}
