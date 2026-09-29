import type { ParseResponse } from './parseTypes';
import { describeRequestFailure } from './requestError';

/** POST a PDF to the native/python parser. Raw bytes avoid multipart boundary bugs in Vite. */
export async function postParsePdf(file: File): Promise<ParseResponse> {
  let response: Response;
  try {
    response = await fetch('/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Document-Title': encodeURIComponent(file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`),
      },
      body: file,
    });
  } catch (error) {
    throw new Error(describeRequestFailure(error, `Upload of ${file.name}`));
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      response.redirected
        ? `Your FreeFlow sign-in expired while uploading ${file.name}. Reload FreeFlow to sign in again, then retry.`
        : `Upload of ${file.name} returned an unexpected response (${response.status}). Reload FreeFlow, then retry.`,
    );
  }

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.detail;
    const message = typeof detail === 'string' ? detail : JSON.stringify(detail || payload);
    throw new Error(message || `Parser returned ${response.status}`);
  }
  return payload as ParseResponse;
}
