import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, Util, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fieldMatchesInspectId, type InspectOverlay } from '../livePacket';
import type { MappedIncomeField, ParsePage } from '../parseTypes';
import { isUsableOverlayBox, padOverlayBox, selectedOverlayParts } from '../overlayBox';
import { pdfScrollTarget } from '../pdfScrollTarget';

GlobalWorkerOptions.workerSrc = pdfWorker;

const RENDER_WIDTH = 720;
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3] as const;
/** Pages this far outside the pane are drawn ahead of time; the rest are released. */
const RENDER_MARGIN_PX = 1200;
const PAGE_GAP_PX = 12;

type Box = { x: number; y: number; w: number; h: number };
type PageSize = { width: number; height: number };
type TextRun = { text: string; box: Box };
type SearchHit = { pageIndex: number; box: Box };

/**
 * The whole source document, one page after another, so an underwriter can
 * scroll the full return and check any figure against it.
 *
 * Clicking a worksheet field scrolls to the page and box it came from. Search
 * runs over the PDF's own text, and over the OCR words for scanned pages that
 * have none. Everything stays in this browser tab; nothing is sent anywhere.
 */
export default function PdfDocumentViewer({
  file,
  pageIndex,
  pageCount,
  fields = [],
  selectedFieldId = null,
  highlight = null,
  onSelectField,
  onPageChange,
  ocrPages = [],
  fillHeight = false,
}: {
  file: File | null;
  pageIndex: number;
  pageCount: number;
  fields?: MappedIncomeField[];
  selectedFieldId?: string | null;
  highlight?: InspectOverlay | null;
  onSelectField?: (id: string) => void;
  onPageChange: (index: number) => void;
  /** Parser pages; their OCR words make scanned pages searchable. */
  ocrPages?: ParsePage[];
  fillHeight?: boolean;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [nearby, setNearby] = useState<Set<number>>(() => new Set([0]));
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const textCache = useRef(new Map<number, TextRun[]>());
  // The page this viewer last reported from scrolling. When the parent echoes
  // it back as pageIndex, that is not a request to move.
  const reportedPage = useRef(pageIndex);
  const lastTargetKey = useRef('');
  // Held in a ref so a parent passing a new function each render does not
  // re-run the search and snap back to its first hit.
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  const fileKey = useMemo(() => (file ? `${file.name}-${file.size}-${file.lastModified}` : ''), [file]);
  const width = RENDER_WIDTH * ZOOM_STEPS[zoomIndex];
  const heightOf = (index: number) => {
    const size = sizes[index];
    return size ? (size.height / size.width) * width : width * (11 / 8.5);
  };

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setPdf(null);
    setSizes([]);
    setHits([]);
    textCache.current = new Map();
    if (!file) return undefined;
    void file
      .arrayBuffer()
      .then((data) => getDocument({ data }).promise)
      .then(async (doc) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        loaded = doc;
        const measured: PageSize[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          const viewport = (await doc.getPage(n)).getViewport({ scale: 1 });
          measured.push({ width: viewport.width, height: viewport.height });
        }
        if (cancelled) return;
        setSizes(measured);
        setPdf(doc);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [fileKey, file]);

  const total = sizes.length || Math.max(pageCount, 1);

  // Draw only the pages near the pane. A long return at full resolution would
  // otherwise hold every page's bitmap in memory at once.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !sizes.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        setNearby((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.pageIndex);
            if (entry.isIntersecting) next.add(index);
            else next.delete(index);
          }
          return next;
        });
      },
      { root: container, rootMargin: `${RENDER_MARGIN_PX}px 0px` },
    );
    pageRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [sizes, zoomIndex]);

  const pageAtScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return 0;
    const probe = container.scrollTop + container.clientHeight * 0.35;
    let found = 0;
    pageRefs.current.forEach((node, index) => {
      if (node && node.offsetTop <= probe) found = index;
    });
    return found;
  }, []);

  const onScroll = useCallback(() => {
    const index = pageAtScroll();
    if (index !== reportedPage.current) {
      reportedPage.current = index;
      onPageChangeRef.current(index);
    }
  }, [pageAtScroll]);

  const scrollToBox = useCallback(
    (index: number, box: Box | null) => {
      const container = scrollRef.current;
      const page = pageRefs.current[index];
      if (!container || !page) return;
      const paneRect = container.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      const { top, left } = pdfScrollTarget(
        { top: paneRect.top, left: paneRect.left, width: container.clientWidth, height: container.clientHeight, scrollTop: container.scrollTop, scrollLeft: container.scrollLeft },
        { top: pageRect.top, left: pageRect.left, width: pageRect.width, height: pageRect.height },
        box,
        PAGE_GAP_PX,
      );
      container.scrollTo({ top, left, behavior: 'auto' });
      // The page shown is the page reported, whatever moved it: a search hit,
      // the page buttons or a worksheet click.
      if (index !== reportedPage.current) {
        reportedPage.current = index;
        onPageChangeRef.current(index);
      }
    },
    [],
  );

  // A worksheet click, a page button, or the parent opening a page: bring it
  // into view. The parent echoing the page this viewer reported is ignored.
  useEffect(() => {
    if (!sizes.length) return;
    const index = Math.min(Math.max(highlight?.pageIndex ?? pageIndex, 0), sizes.length - 1);
    const box = highlight && isUsableOverlayBox(highlight.box) ? highlight.box : null;
    const key = `${index}|${box ? `${box.x},${box.y}` : ''}|${selectedFieldId ?? ''}|${zoomIndex}`;
    if (key === lastTargetKey.current) return;
    const echo = !box && index === reportedPage.current && lastTargetKey.current !== '';
    lastTargetKey.current = key;
    if (echo) return;
    requestAnimationFrame(() => scrollToBox(index, box));
  }, [pageIndex, highlight, selectedFieldId, sizes, zoomIndex, scrollToBox]);

  const textRuns = useCallback(
    async (index: number): Promise<TextRun[]> => {
      const cached = textCache.current.get(index);
      if (cached) return cached;
      const runs: TextRun[] = [];
      if (pdf) {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const tx = Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(tx[2], tx[3]);
          runs.push({
            text: item.str,
            box: {
              x: tx[4] / viewport.width,
              y: (tx[5] - height) / viewport.height,
              w: item.width / viewport.width,
              h: height / viewport.height,
            },
          });
        }
      }
      // A scanned page has no text of its own; its OCR words stand in.
      if (!runs.length) {
        const words = ocrPages.find((page) => page.index === index)?.words ?? [];
        for (const word of words) runs.push({ text: word.text, box: { x: word.x, y: word.y, w: word.w, h: word.h } });
      }
      textCache.current.set(index, runs);
      return runs;
    },
    [pdf, ocrPages],
  );

  useEffect(() => {
    // Compared with whitespace removed: OCR often runs words together
    // ("Ordinarybusiness income"), and a PDF's text runs split phrases anywhere.
    const needle = query.toLowerCase().replace(/\s+/g, '');
    if (needle.length < 2 || !sizes.length) {
      setHits([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const found: SearchHit[] = [];
      for (let index = 0; index < sizes.length && !cancelled; index += 1) {
        const runs = await textRuns(index);
        // Join the page's text so a phrase split across runs still matches,
        // remembering where each run starts to box the hit.
        let haystack = '';
        const starts: number[] = [];
        const lengths: number[] = [];
        for (const run of runs) {
          const folded = run.text.toLowerCase().replace(/\s+/g, '');
          starts.push(haystack.length);
          lengths.push(folded.length);
          haystack += folded;
        }
        for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
          const end = at + needle.length;
          const covered = runs.filter((_, i) => lengths[i] > 0 && starts[i] < end && starts[i] + lengths[i] > at);
          if (!covered.length) continue;
          const x0 = Math.min(...covered.map((run) => run.box.x));
          const y0 = Math.min(...covered.map((run) => run.box.y));
          const x1 = Math.max(...covered.map((run) => run.box.x + run.box.w));
          const y1 = Math.max(...covered.map((run) => run.box.y + run.box.h));
          found.push({ pageIndex: index, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
        }
      }
      if (cancelled) return;
      setHits(found);
      setHitIndex(0);
      setSearching(false);
      if (found.length) scrollToBox(found[0].pageIndex, found[0].box);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, sizes, textRuns, scrollToBox]);

  const goToHit = (next: number) => {
    if (!hits.length) return;
    const wrapped = (next + hits.length) % hits.length;
    setHitIndex(wrapped);
    scrollToBox(hits[wrapped].pageIndex, hits[wrapped].box);
  };

  const current = Math.min(Math.max(pageIndex, 0), total - 1);
  const mappedHere = fields.filter((field) => field.pageIndex === current).length;

  return (
    <div className={fillHeight ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Page {current + 1} / {total} · {mappedHere} mapped field{mappedHere === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="search"
              value={query}
              placeholder="Search document"
              aria-label="Search document"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  goToHit(hitIndex + (event.shiftKey ? -1 : 1));
                }
              }}
              className="w-36 bg-transparent text-[11px] text-slate-700 outline-none"
            />
          </label>
          {query.trim().length >= 2 ? (
            <span className="w-14 text-center tabular-nums text-[11px] text-slate-500" aria-live="polite">
              {searching ? '…' : hits.length ? `${hitIndex + 1} of ${hits.length}` : 'No match'}
            </span>
          ) : null}
          <button type="button" title="Previous match" className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40" disabled={!hits.length} onClick={() => goToHit(hitIndex - 1)}>
            <ChevronUp className="h-4 w-4" />
          </button>
          <button type="button" title="Next match" className="mr-1 rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40" disabled={!hits.length} onClick={() => goToHit(hitIndex + 1)}>
            <ChevronDown className="h-4 w-4" />
          </button>
          <button type="button" title="Zoom out" className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40" disabled={zoomIndex <= 0} onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}>
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-10 text-center tabular-nums text-[11px] text-slate-500">{Math.round(ZOOM_STEPS[zoomIndex] * 100)}%</span>
          <button type="button" title="Zoom in" className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40" disabled={zoomIndex >= ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}>
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" title="Fit width" className="mr-1 rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40" disabled={zoomIndex === 0} onClick={() => setZoomIndex(0)}>
            <Maximize2 className="h-4 w-4" />
          </button>
          <button type="button" title="Previous page" className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40" disabled={current <= 0} onClick={() => scrollToBox(current - 1, null)}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" title="Next page" className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40" disabled={current >= total - 1} onClick={() => scrollToBox(current + 1, null)}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-document-scroll="true"
        className={`${fillHeight ? 'min-h-0 flex-1' : 'max-h-[78vh]'} overflow-auto rounded-lg border border-slate-200 bg-slate-100`}
      >
        <div className="flex flex-col items-start gap-3 p-3" style={{ width: width + 24 }}>
          {Array.from({ length: total }, (_, index) => (
            <div
              key={index}
              ref={(node) => {
                pageRefs.current[index] = node;
              }}
              data-page-index={index}
              className="relative shrink-0 bg-white shadow-sm ring-1 ring-slate-200"
              style={{ width, height: heightOf(index) }}
            >
              <PageCanvas pdf={pdf} index={index} width={width} height={heightOf(index)} draw={nearby.has(index)} />
              <span className="pointer-events-none absolute right-2 top-2 rounded bg-slate-900/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {index + 1}
              </span>
              <PageOverlays
                fields={fields.filter((field) => field.pageIndex === index)}
                selectedFieldId={selectedFieldId}
                highlight={highlight && highlight.pageIndex === index ? highlight.box : null}
                onSelectField={onSelectField}
              />
              {hits.map((hit, n) =>
                hit.pageIndex === index ? (
                  <div
                    key={`hit-${n}`}
                    data-search-hit={n === hitIndex ? 'current' : 'other'}
                    className={`pointer-events-none absolute rounded-sm ${n === hitIndex ? 'z-20 bg-amber-400/45 ring-2 ring-amber-500' : 'z-10 bg-amber-300/35'}`}
                    style={{ left: `${hit.box.x * 100}%`, top: `${hit.box.y * 100}%`, width: `${hit.box.w * 100}%`, height: `${hit.box.h * 100}%` }}
                  />
                ) : null,
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PageCanvas({
  pdf,
  index,
  width,
  height,
  draw,
}: {
  pdf: PDFDocumentProxy | null;
  index: number;
  width: number;
  height: number;
  draw: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    if (!pdf || !draw) {
      // Release the bitmap of a page that has scrolled well out of view.
      canvas.width = 0;
      canvas.height = 0;
      return undefined;
    }
    let task: RenderTask | null = null;
    let cancelled = false;
    void pdf.getPage(index + 1).then((page) => {
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      task = page.render({ canvasContext: context, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, index, width, draw]);

  return <canvas ref={canvasRef} className="block" style={{ width, height }} />;
}

function PageOverlays({
  fields,
  selectedFieldId,
  highlight,
  onSelectField,
}: {
  fields: MappedIncomeField[];
  selectedFieldId: string | null;
  highlight: Box | null;
  onSelectField?: (id: string) => void;
}) {
  // Mark the field under the resolved highlight when there is one; the same
  // source id repeats across Schedule E columns, so the id alone is ambiguous.
  const selected = highlight
    ? fields.find(
        (field) =>
          field.box &&
          Math.abs(field.box.x - highlight.x) < 1e-6 &&
          Math.abs(field.box.y - highlight.y) < 1e-6 &&
          Math.abs(field.box.w - highlight.w) < 1e-6 &&
          Math.abs(field.box.h - highlight.h) < 1e-6,
      )
    : fields.find((field) => field.id === selectedFieldId) ?? fields.find((field) => fieldMatchesInspectId(field, selectedFieldId));

  // A ruled column carries its own shading, so the bracket over it stays
  // unfilled; a wash across every row would hide which ones are counted.
  const ruled = Boolean(selected?.componentCells?.length);

  return (
    <>
      {fields.filter((field) => isUsableOverlayBox(field.box)).flatMap((field) => {
        const isSelected = field === selected;
        const parts = isSelected ? selectedOverlayParts(field) : [{ box: field.box, included: true }];
        return parts.map((part, componentIndex) => {
          const box = padOverlayBox(part.box);
          return (
            <button
              key={`${field.id}-${componentIndex}`}
              type="button"
              data-box-id={componentIndex === 0 ? field.id : `${field.id}--component-${componentIndex}`}
              data-overlay-visible={isSelected ? 'true' : 'false'}
              data-overlay-counted={isSelected ? String(part.included) : undefined}
              title={
                isSelected && !part.included
                  ? `Not counted in ${field.fieldLabel}`
                  : `${field.boxLabel} · ${field.fieldLabel} · ${field.value}`
              }
              className={`absolute box-border rounded-sm ${
                !isSelected
                  ? 'border-0 bg-transparent hover:bg-emerald-400/10'
                  : part.included
                    ? 'z-10 border-2 border-emerald-600 bg-emerald-400/25'
                    : 'z-10 border border-dashed border-slate-400 bg-slate-500/5'
              }`}
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${Math.max(box.w * 100, 0.8)}%`, height: `${Math.max(box.h * 100, 0.7)}%` }}
              onClick={() => onSelectField?.(field.id)}
            />
          );
        });
      })}
      {highlight && isUsableOverlayBox(highlight) ? (() => {
        const box = padOverlayBox(highlight);
        return (
          <div
            data-testid="pdf-highlight"
            data-box-id={selectedFieldId ?? 'inspect-overlay'}
            data-box={`${highlight.x},${highlight.y},${highlight.w},${highlight.h}`}
            data-overlay-visible="true"
            data-inspect-overlay="true"
            className={`pointer-events-none absolute z-20 box-border rounded-sm border-2 border-emerald-600 ${ruled ? '' : 'bg-emerald-400/10'}`}
            style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${Math.max(box.w * 100, 0.8)}%`, height: `${Math.max(box.h * 100, 0.7)}%` }}
          />
        );
      })() : null}
    </>
  );
}
