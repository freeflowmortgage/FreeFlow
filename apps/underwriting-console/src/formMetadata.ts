import type { ParseWord } from './parseTypes';

/** IRS / LiveCycle / XFA field names and PDF metadata that must never be mapped. */
const FIELD_FQN = /\w+\[\d+\](?:\.\w+\[\d+\])+/;
const FIELD_TAIL = /^f\d+_\d+(?:\[\d+\])?$/i;
const METADATA_BLOB =
  /topmostSubform|form1\[\d+\]|xfa:|xmpmeta|<\?xml|adobe:ns:meta|edge_all_open_tabs|\/Type\s*\/Metadata/i;

export function isFormMetadataNoise(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  if (METADATA_BLOB.test(value)) return true;
  if (FIELD_FQN.test(value)) return true;
  if (FIELD_TAIL.test(value)) return true;
  return false;
}

export function scrubFormMetadataText(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => !isFormMetadataNoise(token))
    .join(' ');
}

export function scrubWords<T extends { text: string }>(words: T[]): T[] {
  return words.filter((word) => !isFormMetadataNoise(word.text));
}

export function tokensFromFieldValue(
  value: string,
  box: { x: number; y: number; w: number; h: number },
): ParseWord[] {
  const tokens = value
    .trim()
    .split(/\s+/)
    .filter((token) => token && !isFormMetadataNoise(token));
  if (!tokens.length) return [];
  const gap = Math.min(0.004, box.w * 0.02);
  const usable = Math.max(box.w - gap * Math.max(tokens.length - 1, 0), 0.01);
  const letters = tokens.reduce((sum, token) => sum + token.length, 0) || 1;
  let x = box.x;
  return tokens.map((token) => {
    const w = Math.max((token.length / letters) * usable, 0.012);
    const word: ParseWord = {
      text: token,
      x,
      y: box.y,
      w,
      h: Math.max(box.h, 0.012),
      confidence: 100,
    };
    x += w + gap;
    return word;
  });
}

function boxesOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function mergeFillableWords(native: ParseWord[], fillable: ParseWord[]): ParseWord[] {
  const extras = fillable.filter((word) => {
    if (isFormMetadataNoise(word.text)) return false;
    return !native.some((item) => item.text === word.text && boxesOverlap(item, word));
  });
  return scrubWords([...native, ...extras]);
}
