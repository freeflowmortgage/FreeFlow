const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,99}$/;

/** Emit an identifier-free connector error metric source line. */
export function emitConnectorError(code: string, status: number): void {
  console.info(JSON.stringify({
    source: 'freeflow',
    event: 'connector_error',
    code: SAFE_CODE.test(code) ? code : 'UNSAFE_CODE_REDACTED',
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500,
  }));
}
