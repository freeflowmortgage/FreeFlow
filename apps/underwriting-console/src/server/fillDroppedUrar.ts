/**
 * Support for a user-dropped URAR 1004: place a PDF at
 * public/fixtures/blank/1004urar.pdf (also accepted: urar-1004.pdf, 1004.pdf)
 * and the appraisal demo serves it instead of the generated facsimile.
 *
 * - Fillable blanks (AcroForm text fields) are auto-filled with the demo
 *   subject data before serving.
 * - Already-completed or flat PDFs are served exactly as dropped, so a 1004
 *   the user filled out by hand works as the demo document.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fillAppraisalPdfWithDemoData } from '../appraisalDemoFill';

const BLANK_DIR = path.resolve(process.cwd(), 'public/fixtures/blank');
const CANDIDATES = ['1004urar.pdf', 'urar-1004.pdf', '1004.pdf'];

export interface DroppedUrar {
  bytes: Uint8Array;
  autoFilled: boolean;
}

async function readDropped(): Promise<Uint8Array | null> {
  for (const name of CANDIDATES) {
    try {
      return new Uint8Array(await readFile(path.join(BLANK_DIR, name)));
    } catch {
      /* not present – try next candidate */
    }
  }
  return null;
}

export async function loadDroppedUrar(serveRaw: boolean): Promise<DroppedUrar | null> {
  const raw = await readDropped();
  if (!raw) return null;
  if (serveRaw) return { bytes: raw, autoFilled: false };

  const filled = await fillAppraisalPdfWithDemoData(raw).catch(() => null);
  if (filled) return { bytes: filled.bytes, autoFilled: true };
  // No fillable fields — the document is already complete (or a flat scan);
  // serve it as dropped.
  return { bytes: raw, autoFilled: false };
}

export async function droppedUrarExists(): Promise<boolean> {
  return (await readDropped()) !== null;
}
