import { generatePaystubPdf } from './generatePaystubPdf';
import { generateW2Pdf } from './generateW2Pdf';
import { fillK1Partnership, fillK1SCorp, fillScheduleC, fillScheduleE, fillW2, num } from './demoDocs';

/** Generates only the allowlisted synthetic documents used by the comparison demo. */
export async function generateDemoFixtureDocument(
  pathname: string,
  params: URLSearchParams,
): Promise<Readonly<{ kind: string; bytes: Uint8Array }> | null> {
  const prefix = '/fixtures/docs/';
  if (!pathname.startsWith(prefix) || !pathname.endsWith('.pdf')) return null;
  const kind = pathname.slice(prefix.length, -'.pdf'.length);
  const producers: Readonly<Record<string, () => Promise<Uint8Array>>> = {
    paystub: () => generatePaystubPdf({
      employer: params.get('employer') || 'Apex Technology Partners LLC',
      borrower: params.get('borrower') || 'Sarah K. Vance',
      hourly: num(params, 'hourly', 45),
      hours: num(params, 'hours', 40),
      periodPay: num(params, 'period', 3600),
      ytdBase: num(params, 'ytdBase', 54000),
      ytdBonus: num(params, 'ytdBonus', 12500),
      ytdOt: num(params, 'ytdOt', 4200),
    }),
    w2: () => fillW2(params).catch(() => generateW2Pdf({
      year: num(params, 'year', 2025),
      employer: params.get('employer') || 'Digital Solutions Corp',
      ein: params.get('ein') || '94-8765432',
      borrower: params.get('borrower') || 'Sarah K. Vance',
      box1: num(params, 'box1', 74000),
      box5: num(params, 'box5', 78500),
      bonus: num(params, 'bonus', 18000),
      overtime: num(params, 'ot', 6000),
    })),
    'schedule-e': () => fillScheduleE(params),
    'schedule-c': () => fillScheduleC(params),
    'k1-1065': () => fillK1Partnership(params),
    'k1-1120s': () => fillK1SCorp(params),
  };
  const producer = producers[kind];
  return producer ? { kind, bytes: await producer() } : null;
}
