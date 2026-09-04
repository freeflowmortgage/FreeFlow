import type { ParseResponse } from './parseTypes';

/** POST a PDF to the native/python parser. Raw bytes avoid multipart boundary bugs in Vite. */
export async function postParsePdf(file: File): Promise<ParseResponse> {
  const response = await fetch('/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-Document-Title': file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`,
    },
    body: file,
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.detail;
    const message = typeof detail === 'string' ? detail : JSON.stringify(detail || payload);
    throw new Error(message || `Parser returned ${response.status}`);
  }
  return payload as ParseResponse;
}
