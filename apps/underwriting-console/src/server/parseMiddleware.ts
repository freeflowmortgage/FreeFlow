import type { IncomingMessage, ServerResponse } from 'http';
import type { Connect } from 'vite';
import { mapIncomeFields } from '../incomeFieldMap';
import type { ParsePage, ParseResponse, ParseWord } from '../parseTypes';
import { generateIncomeSmokePdf } from './generateIncomeSmokePdf';
import { generateUrarPdf } from './generateUrarPdf';
import { generatePaystubPdf } from './generatePaystubPdf';
import { fillK1Partnership, fillK1SCorp, fillScheduleC, fillScheduleE, fillW2, num } from './demoDocs';
import { droppedUrarExists, loadDroppedUrar } from './fillDroppedUrar';

const DEFAULT_DOC_PARSER_URL = 'http://127.0.0.1:8080';
const PYTHON_PARSE = `${(process.env.DOC_PARSER_URL || process.env.DOC_PARSER_SERVICE_URL || DEFAULT_DOC_PARSER_URL).replace(/\/+$/, '')}/parse`;
const PYTHON_HEALTH = `${(process.env.DOC_PARSER_URL || process.env.DOC_PARSER_SERVICE_URL || DEFAULT_DOC_PARSER_URL).replace(/\/+$/, '')}/health`;
const MAX_PDF_BYTES = 40 * 1024 * 1024;

const CLASSIFIERS: Array<[string, RegExp]> = [
  ['Form 1040 (Individual Return)', /Form\s+1040|U\.S\.\s+Individual Income Tax Return/i],
  ['Schedule B (Interest & Dividends)', /Schedule B.*Interest and Ordinary Dividends/i],
  ['Schedule C (Page 1 - Profits)', /Schedule C.*Profit or Loss From Business|Profit or Loss From Business/i],
  ['Schedule C (Page 2 - Mileage)', /Schedule C \(Form 1040\).*Page 2|Part IV.*Information on Your Vehicle|Part V.*Other Expenses/i],
  ['Schedule D (Capital Gains)', /Schedule D.*Capital Gains and Losses/i],
  ['Schedule E (Page 1 - Rentals)', /Schedule E.*Supplemental Income and Loss/i],
  ['Schedule E (Page 2 - K-1s)', /Schedule E \(Form 1040\).*Page 2|Part II.*Income or Loss From Partnerships/i],
  ['Schedule F (Farm Income)', /Schedule F(?:\s*\(Form 1040\))?.*Profit or Loss From Farming|Profit or Loss From Farming/i],
  ['Form 1120S (S-Corporation Return)', /U\.S\. Income Tax Return for an S Corporation/i],
  ['Form 1065 (Partnership Return)', /U\.S\. Return of Partnership Income/i],
  ['Form 1120 (C-Corporation Return)', /U\.S\. Corporation Income Tax Return/i],
  ['Schedule K-1 (1065)', /Schedule K-1\s*\(Form\s*1065\)/i],
  ['Schedule K-1 (1120-S)', /Schedule K-1\s*\(Form\s*1120-?S\)/i],
  ['Form 8825 (Corporate Rentals)', /Form 8825.*Rental Real Estate Income and Expenses/i],
  ['Form 4562 (Depreciation)', /Form 4562/i],
  ['W-2', /Wage and Tax Statement|Form\s+W-?2|W-2\s+Wage/i],
  ['Paystub', /earnings statement|pay\s*stub|paystub|payroll statement|year[- ]to[- ]date/i],
  ['WVOE', /written verification of employment|verification of employment|the work number|\bWVOE\b/i],
];

function pathOf(req: IncomingMessage): string {
  return (req.url || '').split('?')[0];
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function indexOf(haystack: Buffer, needle: Buffer, start = 0): number {
  return haystack.indexOf(needle, start);
}

function parseMultipartPdf(buffer: Buffer, contentType: string): { bytes: Buffer; name: string } | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  const boundary = `--${(match[1] || match[2]).trim()}`;
  const marker = Buffer.from(boundary);
  let cursor = 0;
  while (cursor < buffer.length) {
    const start = indexOf(buffer, marker, cursor);
    if (start < 0) break;
    const next = indexOf(buffer, marker, start + marker.length);
    const part = buffer.slice(start + marker.length, next < 0 ? buffer.length : next);
    cursor = next < 0 ? buffer.length : next;
    const headerEnd = indexOf(part, Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd).toString('utf8');
    if (!/filename=/i.test(header) && !/name="file"/i.test(header)) continue;
    const filename = /filename="([^"]+)"/i.exec(header)?.[1] || 'document.pdf';
    let body = part.slice(headerEnd + 4);
    if (body.slice(-2).toString('binary') === '\r\n') body = body.slice(0, -2);
    if (body.slice(0, 2).toString('binary') === '\r\n') body = body.slice(2);
    return { bytes: body, name: filename };
  }
  return null;
}

async function readPdf(req: IncomingMessage): Promise<{ bytes: Buffer; name: string }> {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  const body = await readBody(req);
  if (contentType.includes('multipart/form-data')) {
    const parsed = parseMultipartPdf(body, contentType);
    if (!parsed || !parsed.bytes.length) {
      throw new Error('Expected multipart file field named file.');
    }
    return parsed;
  }
  if (contentType.includes('application/pdf') || body.slice(0, 5).toString() === '%PDF-') {
    const name = (req.headers['x-document-title'] as string) || 'document.pdf';
    return { bytes: body, name };
  }
  throw new Error('Expected application/pdf body or multipart file field.');
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function classifyText(text: string): string[] {
  return CLASSIFIERS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

async function extractNativePages(bytes: Buffer): Promise<ParsePage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
  } as any);
  const pdf = await task.promise;
  const pages: ParsePage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const words: ParseWord[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const tx = item.transform;
        const xPt = tx[4];
        const yPt = tx[5];
        const width = item.width || Math.abs(tx[0]) * item.str.length * 0.5;
        const height = item.height || Math.abs(tx[3]) || 11;
        words.push({
          text: item.str.trim(),
          x: Math.max(0, Math.min(1, xPt / viewport.width)),
          y: Math.max(0, Math.min(1, 1 - (yPt + height) / viewport.height)),
          w: Math.max(0, Math.min(1, width / viewport.width)),
          h: Math.max(0, Math.min(1, height / viewport.height)),
          confidence: 100,
        });
      }
      const text = words.map((word) => word.text).join(' ');
      const formIds = classifyText(text);
      pages.push({
        index: pageNumber - 1,
        formIds,
        isNativeText: true,
        inKeepSet: formIds.length > 0,
        meanConfidence: 100,
        skewDegrees: 0,
        words,
        flags: [],
      });
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

function toParseResponse(pages: ParsePage[], filename: string, engine: ParseResponse['parser_engine']): ParseResponse {
  const classifications: Record<string, string[]> = {};
  const extracted: number[] = [];
  for (const page of pages) {
    if (page.formIds.length) {
      classifications[String(page.index)] = page.formIds;
      extracted.push(page.index);
    }
  }
  const payload: ParseResponse = {
    transaction_id: crypto.randomUUID(),
    total_pages_scanned: pages.length,
    pages_extracted_count: extracted.length,
    extracted_page_indices: extracted,
    ocr_page_count: engine === 'python-ocr' ? pages.filter((page) => !page.isNativeText).length : 0,
    has_business_returns: pages.some((page) =>
      page.formIds.some((label) => /schedule c|schedule e|schedule f|form 1120|form 1065|k-1/i.test(label)),
    ),
    flags: extracted.length ? [] : ['no_core_forms_detected'],
    classifications,
    unresolved_statements: [],
    pages,
    parser_engine: engine,
  };
  payload.incomeFields = mapIncomeFields(payload);
  payload.original_filename = filename;
  return payload;
}

async function tryPythonParse(bytes: Buffer, name: string): Promise<ParseResponse | null> {
  try {
    const response = await fetch(PYTHON_PARSE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Document-Title': name,
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ParseResponse;
    payload.parser_engine = 'python-ocr';
    payload.incomeFields = mapIncomeFields(payload);
    return payload;
  } catch {
    return null;
  }
}

async function tryPythonHealth(): Promise<boolean> {
  try {
    const response = await fetch(PYTHON_HEALTH, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

export function parseMiddleware(): Connect.NextHandleFunction {
  const samplePdf = generateIncomeSmokePdf();
  const urarPdf = generateUrarPdf();

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = pathOf(req);

    if (path === '/fixtures/income-smoke.pdf' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="income-smoke.pdf"');
      res.end(samplePdf);
      return;
    }

    if (path === '/fixtures/urar-1004.pdf' && req.method === 'GET') {
      const isBlank = (req.url || '').includes('blank=true');
      // A real 1004 dropped into public/fixtures/blank/ takes precedence over
      // the generated facsimile: fillable blanks get demo data written in,
      // already-completed PDFs are served as dropped.
      void loadDroppedUrar(isBlank)
        .then((dropped) => dropped?.bytes ?? (isBlank ? generateUrarPdf(true) : urarPdf))
        .then((bytes) => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'inline; filename="LN-2026-9043-URAR-1004.pdf"');
          res.end(bytes);
        }).catch((error) => {
          sendJson(res, 500, { detail: error instanceof Error ? error.message : 'URAR fixture failed.' });
        });
      return;
    }

    if (path === '/fixtures/urar-1004.meta.json' && req.method === 'GET') {
      // Lets the appraisal workspace know a user document replaced the
      // facsimile (its coordinate overlays only fit the generated layout).
      void droppedUrarExists()
        .then((custom) => sendJson(res, 200, { custom }))
        .catch(() => sendJson(res, 200, { custom: false }));
      return;
    }

    if (path.startsWith('/fixtures/docs/') && req.method === 'GET') {
      const params = new URLSearchParams((req.url || '').split('?')[1] ?? '');
      const kind = path.slice('/fixtures/docs/'.length).replace(/\.pdf$/, '');
      const producers: Record<string, () => Promise<Uint8Array>> = {
        paystub: () =>
          generatePaystubPdf({
            employer: params.get('employer') || 'Apex Technology Partners LLC',
            borrower: params.get('borrower') || 'Sarah K. Vance',
            hourly: num(params, 'hourly', 45),
            hours: num(params, 'hours', 40),
            periodPay: num(params, 'period', 3600),
            ytdBase: num(params, 'ytdBase', 54000),
            ytdBonus: num(params, 'ytdBonus', 12500),
            ytdOt: num(params, 'ytdOt', 4200),
          }),
        w2: () => fillW2(params),
        'schedule-e': () => fillScheduleE(params),
        'schedule-c': () => fillScheduleC(params),
        'k1-1065': () => fillK1Partnership(params),
        'k1-1120s': () => fillK1SCorp(params),
      };
      const producer = producers[kind];
      if (!producer) {
        sendJson(res, 404, { detail: `Unknown demo document '${kind}'.` });
        return;
      }
      void producer()
        .then((bytes) => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="${kind}-demo.pdf"`);
          res.end(bytes);
        })
        .catch((error) => {
          sendJson(res, 500, { detail: error instanceof Error ? error.message : 'Demo document failed.' });
        });
      return;
    }

    if (path === '/health' && req.method === 'GET') {
      void tryPythonHealth().then((python) => {
        sendJson(res, 200, {
          status: 'HEALTHY',
          service: python ? 'FreeFlow Document Processing Engine' : 'FreeFlow native tax parser',
          version: python ? '5.0.0' : 'native-1.0.0',
          engine: python ? 'python-ocr' : 'native-pdf',
        });
      });
      return;
    }

    if (path !== '/parse' && path !== '/api/underwrite/process') {
      next();
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      res.end();
      return;
    }

    void (async () => {
      try {
        const { bytes, name } = await readPdf(req);
        if (!name.toLowerCase().endsWith('.pdf') && bytes.slice(0, 5).toString() !== '%PDF-') {
          sendJson(res, 400, { detail: 'Only PDF files are authorized for ingestion.' });
          return;
        }
        if (!bytes.length) {
          sendJson(res, 400, { detail: 'Empty PDF body.' });
          return;
        }
        if (bytes.length > MAX_PDF_BYTES) {
          sendJson(res, 413, { detail: 'PDF exceeds parser size limit.' });
          return;
        }
        const python = await tryPythonParse(bytes, name);
        if (python) {
          sendJson(res, 200, python);
          return;
        }
        const pages = await extractNativePages(bytes);
        sendJson(res, 200, toParseResponse(pages, name, 'native-pdf'));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Document processing failed.';
        sendJson(res, 500, { detail: message });
      }
    })();
  };
}
