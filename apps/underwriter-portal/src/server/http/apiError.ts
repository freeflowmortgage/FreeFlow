export class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export function sendApiError(
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  requestId: string,
  error: ApiError,
) {
  return res.status(error.status).json({
    error: {
      code: error.code,
      message: error.publicMessage,
      requestId,
    },
  });
}
