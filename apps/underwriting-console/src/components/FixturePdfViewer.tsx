import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isUsableOverlayBox, padOverlayBox } from '../overlayBox';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { describeRequestFailure, reloadFreeFlow } from '../requestError';

GlobalWorkerOptions.workerSrc = pdfWorker;

const RENDER_WIDTH = 860;

export type FixtureBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
};

export type FixtureLocate = {
  id: string;
  needle?: string;
  /** Prefer a hit on the line that contains this label (e.g. Regular / Overtime / Bonus). */
  lineHint?: string;
  /** 0-based money token on that line (Regular RATE=0, HOURS=1, CURRENT=2, YTD=3). */
  moneyIndex?: number;
};

type Glyph = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

function norm(value: string): string {
  return value.replace(/[$,\s]/g, '').toLowerCase();
}

function glyphsFromContent(
  items: Array<{ str?: string; width?: number; height?: number; transform: number[] }>,
  viewport: { width: number; height: number; convertToViewportPoint: (x: number, y: number) => number[] },
): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const xPdf = item.transform[4];
    const yPdf = item.transform[5];
    const heightPdf = item.height || Math.abs(item.transform[3]) || 9;
    const widthPdf = item.width || Math.abs(item.transform[0]) * item.str.length * 0.5;
    const topLeft = viewport.convertToViewportPoint(xPdf, yPdf + heightPdf);
    const bottomRight = viewport.convertToViewportPoint(xPdf + widthPdf, yPdf);
    const left = Math.min(topLeft[0], bottomRight[0]);
    const top = Math.min(topLeft[1], bottomRight[1]);
    const right = Math.max(topLeft[0], bottomRight[0]);
    const bottom = Math.max(topLeft[1], bottomRight[1]);
    glyphs.push({
      str: item.str,
      x: (left / viewport.width) * 100,
      y: (top / viewport.height) * 100,
      w: ((right - left) / viewport.width) * 100,
      h: ((bottom - top) / viewport.height) * 100,
    });
  }
  return glyphs;
}

function isMoneyToken(value: string): boolean {
  return /^-?\$?\d/.test(value.trim()) || /\d{1,3}(?:,\d{3})*\.\d{2}/.test(value);
}

function locateBoxes(glyphs: Glyph[], locate: FixtureLocate[]): FixtureBox[] {
  const lines: Glyph[][] = [];
  const yTol = 0.7;
  const sorted = [...glyphs].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const glyph of sorted) {
    const line = lines.find((row) => Math.abs(row[0].y - glyph.y) <= yTol);
    if (line) line.push(glyph);
    else lines.push([glyph]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);

  const found: FixtureBox[] = [];
  for (const anchor of locate) {
    const hinted = anchor.lineHint
      ? lines.filter((line) => line.some((g) => g.str.toLowerCase().includes(anchor.lineHint!.toLowerCase())))
      : lines;
    const search = hinted.length ? hinted : lines;
    let hit: Glyph | undefined;
    if (anchor.moneyIndex != null) {
      for (const line of search) {
        const money = line.filter((g) => isMoneyToken(g.str));
        if (money[anchor.moneyIndex]) {
          hit = money[anchor.moneyIndex];
          break;
        }
      }
    }
    const needle = anchor.needle ? norm(anchor.needle) : '';
    if (!hit && needle) {
      for (const line of search) {
        hit = line.find((g) => {
          const token = norm(g.str);
          return token.includes(needle) || needle.includes(token);
        });
        if (hit) break;
        const joined = norm(line.map((g) => g.str).join(''));
        if (joined.includes(needle)) {
          hit = line.find((g) => isMoneyToken(g.str)) ?? line[line.length - 1];
          break;
        }
      }
    }
    if (!hit) continue;
    found.push({
      id: anchor.id,
      x: hit.x - 0.3,
      y: hit.y - 0.15,
      width: Math.max(hit.w + 0.6, 1.2),
      height: Math.max(hit.h + 0.35, 1.1),
      selected: false,
    });
  }
  return found;
}

async function measureLocate(page: PDFPageProxy, locate: FixtureLocate[]): Promise<FixtureBox[]> {
  const viewport = page.getViewport({ scale: RENDER_WIDTH / page.getViewport({ scale: 1 }).width });
  const content = await page.getTextContent();
  const glyphs = glyphsFromContent(content.items as Array<{ str?: string; width?: number; height?: number; transform: number[] }>, viewport);
  return locateBoxes(glyphs, locate);
}

/**
 * Renders a server-generated demo document (filled IRS form / pay stub) from a
 * fixture URL. Highlight boxes prefer live pdf.js text positions so Inspect
 * Coordinates lands on the printed figure, not a stale facsimile map.
 */
export default function FixturePdfViewer({
  url,
  label,
  boxes = [],
  locate = [],
  selectedId = null,
  onSelect,
}: {
  url: string;
  label: string;
  boxes?: FixtureBox[];
  locate?: FixtureLocate[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [located, setLocated] = useState<FixtureBox[]>([]);
  const locateKey = JSON.stringify(locate);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);
    setPageIndex(0);
    setLocated([]);
    pdfRef.current?.destroy().catch(() => undefined);
    pdfRef.current = null;

    void fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Loading the ${label} source document failed (HTTP ${res.status}).`);
        return res.arrayBuffer();
      })
      .then((data) => getDocument({ data }).promise)
      .then((pdf) => {
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setStatus('ready');
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(describeRequestFailure(error, `Loading the ${label} source document`));
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      pdfRef.current?.destroy().catch(() => undefined);
      pdfRef.current = null;
    };
  }, [url, label]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || status !== 'ready') return;
    let cancelled = false;

    void pdf.getPage(Math.min(pageIndex, pdf.numPages - 1) + 1).then(async (page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: RENDER_WIDTH / page.getViewport({ scale: 1 }).width });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      await page.render({ canvasContext: context, viewport }).promise;
      if (cancelled) return;
      if (locate.length) {
        const next = await measureLocate(page, JSON.parse(locateKey) as FixtureLocate[]);
        if (!cancelled) setLocated(next);
      } else {
        setLocated([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pageIndex, status, locateKey]);

  if (status === 'error') {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
        <p>{errorMessage || `Could not load the ${label} source document.`}</p>
        <button
          type="button"
          onClick={reloadFreeFlow}
          className="mt-2 rounded-md border border-rose-300 bg-white px-2.5 py-1 font-bold text-rose-700 hover:bg-rose-100"
        >
          Reload FreeFlow
        </button>
      </div>
    );
  }

  const overlay = (located.length ? located : boxes).map((box) => ({
    ...box,
    selected: box.id === selectedId,
  }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {label} · page {pageIndex + 1} / {Math.max(pageCount, 1)}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
              disabled={pageIndex <= 0}
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
              disabled={pageIndex >= pageCount - 1}
              onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        {status === 'loading' && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            Rendering document…
          </p>
        )}
        <canvas ref={canvasRef} className="block h-auto max-w-full" />
        {overlay.filter((box) => isUsableOverlayBox(box)).map((box) => {
          const padded = padOverlayBox(box);
          return (
            <button
              key={box.id}
              type="button"
              title={box.id}
              data-box-id={box.id}
              data-overlay-visible={box.selected ? 'true' : 'false'}
              className={`absolute box-border rounded-sm ${
                box.selected
                  ? 'z-10 border-2 border-emerald-600 bg-emerald-400/10'
                  : 'border-0 bg-transparent'
              }`}
              style={{
                left: `${padded.x}%`,
                top: `${padded.y}%`,
                width: `${Math.max(padded.w, 1.2)}%`,
                height: `${Math.max(padded.h, 1.1)}%`,
              }}
              onClick={() => onSelect?.(box.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
