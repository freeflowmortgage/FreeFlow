import type { ParseResponse } from './parseTypes';

// The protected console never sends document bytes to a console-owned endpoint.
// Authoritative document processing is initiated through the portal API instead.
export async function postParsePdf(_file: File): Promise<ParseResponse> {
  throw new Error('Document processing is available only through the protected loan workflow.');
}
