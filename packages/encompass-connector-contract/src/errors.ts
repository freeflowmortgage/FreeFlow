export class EncompassConnectorError extends Error {
  constructor(
    public readonly safeCode: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EncompassConnectorError';
  }
}
