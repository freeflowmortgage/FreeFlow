/**
 * Support for a user-dropped real blank URAR 1004: place a fillable blank at
 * public/fixtures/blank/1004urar.pdf (or urar-1004.pdf) and the appraisal demo
 * serves it auto-filled with the demo subject data instead of the generated
 * facsimile. Flat (non-fillable) blanks are ignored with a console note.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fillAppraisalPdfWithDemoData } from '../appraisalDemoFill';

const BLANK_DIR = path.resolve(process.cwd(), 'public/fixtures/blank');
const CANDIDATES = ['1004urar.pdf', 'urar-1004.pdf', '1004.pdf'];

let warnedFlat = false;

export async function fillDroppedUrarBlank(serveBlank: boolean): Promise<Uint8Array | null> {
  let raw: Uint8Array | null = null;
  for (const name of CANDIDATES) {
    try {
      raw = new Uint8Array(await readFile(path.join(BLANK_DIR, name)));
      break;
    } catch {
      /* not present – try next candidate */
    }
  }
  if (!raw) return null;
  if (serveBlank) return raw;

  const filled = await fillAppraisalPdfWithDemoData(raw);
  if (!filled) {
    if (!warnedFlat) {
      warnedFlat = true;
      console.warn(
        '[freeflow] public/fixtures/blank URAR has no fillable form fields; serving the generated facsimile instead.',
      );
    }
    return null;
  }
  return filled.bytes;
}
