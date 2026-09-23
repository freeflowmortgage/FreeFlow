import type { ParseWord } from '../parseTypes';
import { isFormMetadataNoise, mergeFillableWords, tokensFromFieldValue } from '../formMetadata';

type PdfJsPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  getAnnotations: (params?: { intent?: string }) => Promise<unknown[]>;
};

function normalizeFieldValue(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeFieldValue(item)).filter(Boolean).join(' ');
  }
  if (typeof raw === 'object' && 'name' in (raw as object)) {
    return '';
  }
  return String(raw).trim();
}

function pdfRectToBox(rect: number[], width: number, height: number): { x: number; y: number; w: number; h: number } {
  const x1 = Number(rect[0]);
  const y1 = Number(rect[1]);
  const x2 = Number(rect[2]);
  const y2 = Number(rect[3]);
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const bottom = Math.min(y1, y2);
  const top = Math.max(y1, y2);
  return {
    x: Math.max(0, Math.min(1, left / width)),
    y: Math.max(0, Math.min(1, 1 - top / height)),
    w: Math.max(0, Math.min(1, (right - left) / width)),
    h: Math.max(0, Math.min(1, (top - bottom) / height)),
  };
}

export async function wordsFromWidgetValues(page: PdfJsPage): Promise<ParseWord[]> {
  const viewport = page.getViewport({ scale: 1 });
  let annotations: Array<Record<string, unknown>> = [];
  try {
    annotations = (await page.getAnnotations({ intent: 'display' })) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
  const words: ParseWord[] = [];
  for (const annot of annotations) {
    const subtype = String(annot.subtype ?? '');
    if (subtype && subtype !== 'Widget') continue;
    const fieldType = String(annot.fieldType ?? '');
    if (fieldType === 'Btn') continue;
    const value = normalizeFieldValue(annot.fieldValue);
    if (!value || isFormMetadataNoise(value)) continue;
    const rect = annot.rect;
    if (!Array.isArray(rect) || rect.length < 4) continue;
    const box = pdfRectToBox(rect.map(Number), viewport.width, viewport.height);
    words.push(...tokensFromFieldValue(value, box));
  }
  return words;
}

export async function mergeNativeAndFillableWords(page: PdfJsPage, native: ParseWord[]): Promise<ParseWord[]> {
  const fillable = await wordsFromWidgetValues(page);
  return mergeFillableWords(native, fillable);
}
