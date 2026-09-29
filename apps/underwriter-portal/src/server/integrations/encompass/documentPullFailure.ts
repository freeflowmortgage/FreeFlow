import { EncompassApiError } from './encompassApi';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,99}$/;
const PRISMA_CODE = /^P[0-9]{4}$/;
const POSTGRES_CODE = /^[0-9]{2}[0-9A-Z]{3}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,80}$/;
const REDACTED = '[redacted]';

export type ClassifiedDocumentPullFailure = Readonly<{
  safeCode: string;
  retryable: boolean;
}>;

const RETRYABLE_PRISMA: Readonly<Record<string, string>> = {
  P1001: 'DOCUMENT_PULL_DB_UNAVAILABLE',
  P1002: 'DOCUMENT_PULL_DB_UNAVAILABLE',
  P1008: 'DOCUMENT_PULL_DB_TIMEOUT',
  P1017: 'DOCUMENT_PULL_DB_UNAVAILABLE',
  P2024: 'DOCUMENT_PULL_DB_UNAVAILABLE',
  P2028: 'DOCUMENT_PULL_DB_TIMEOUT',
  P2034: 'DOCUMENT_PULL_DB_CONTENTION',
};

const NONRETRYABLE_PRISMA: Readonly<Record<string, string>> = {
  P2000: 'DOCUMENT_PULL_DB_VALUE_LENGTH',
  P2003: 'DOCUMENT_PULL_DB_REFERENCE',
  P2004: 'DOCUMENT_PULL_DB_CHECK',
  P2011: 'DOCUMENT_PULL_DB_NOT_NULL',
  P2012: 'DOCUMENT_PULL_DB_INPUT',
  P2020: 'DOCUMENT_PULL_DB_RANGE',
  P2025: 'DOCUMENT_PULL_DB_RECORD_MISSING',
};

/**
 * Classify the worker catch. Known Encompass errors keep their safe code.
 * Prisma and PostgreSQL failures get a dedicated code instead of the catch-all.
 * DOCUMENT_PULL_UNEXPECTED remains the fallback for still-untyped throws.
 */
export function classifyDocumentPullFailure(error: unknown): ClassifiedDocumentPullFailure {
  if (error instanceof EncompassApiError || error instanceof EncompassConnectorError) {
    return {
      safeCode: SAFE_CODE.test(error.safeCode) ? error.safeCode : 'DOCUMENT_PULL_UNEXPECTED',
      retryable: error.retryable,
    };
  }

  const prismaCode = readPrismaCode(error);
  const postgresCode = readPostgresCode(error);
  if (prismaCode === 'P2002' || postgresCode === '23505') {
    return { safeCode: 'DOCUMENT_PULL_DB_CONFLICT', retryable: true };
  }
  if (prismaCode && RETRYABLE_PRISMA[prismaCode]) {
    return { safeCode: RETRYABLE_PRISMA[prismaCode], retryable: true };
  }
  if (prismaCode && NONRETRYABLE_PRISMA[prismaCode]) {
    return { safeCode: NONRETRYABLE_PRISMA[prismaCode], retryable: false };
  }
  if (error instanceof Error && error.name === 'PrismaClientValidationError') {
    return { safeCode: 'DOCUMENT_PULL_DB_INPUT', retryable: false };
  }
  if (error instanceof Error && error.name === 'PrismaClientInitializationError') {
    return { safeCode: 'DOCUMENT_PULL_DB_UNAVAILABLE', retryable: true };
  }

  switch (postgresCode) {
    case '23503':
      return { safeCode: 'DOCUMENT_PULL_DB_REFERENCE', retryable: false };
    case '23502':
      return { safeCode: 'DOCUMENT_PULL_DB_NOT_NULL', retryable: false };
    case '23514':
      return { safeCode: 'DOCUMENT_PULL_DB_CHECK', retryable: false };
    case '22001':
      return { safeCode: 'DOCUMENT_PULL_DB_VALUE_LENGTH', retryable: false };
    case '22003':
      return { safeCode: 'DOCUMENT_PULL_DB_RANGE', retryable: false };
    case '42P10':
      return { safeCode: 'DOCUMENT_PULL_DB_CONFLICT_TARGET', retryable: false };
    case '42501':
      return { safeCode: 'DOCUMENT_PULL_DB_DENIED', retryable: false };
    case '40P01':
    case '40001':
    case '55P03':
      return { safeCode: 'DOCUMENT_PULL_DB_CONTENTION', retryable: true };
    case '57014':
      return { safeCode: 'DOCUMENT_PULL_DB_TIMEOUT', retryable: true };
    default:
      break;
  }
  if (postgresCode?.startsWith('08')) {
    return { safeCode: 'DOCUMENT_PULL_DB_UNAVAILABLE', retryable: true };
  }
  return { safeCode: 'DOCUMENT_PULL_UNEXPECTED', retryable: true };
}

export function isUniqueViolation(error: unknown): boolean {
  return readPrismaCode(error) === 'P2002' || readPostgresCode(error) === '23505';
}

/**
 * Safe diagnostic for the document-pull catch. The message is the first line
 * only, with secrets, document bytes, and contact data removed. Stacks are omitted.
 */
export function logDocumentPullFailure(error: unknown, classified: ClassifiedDocumentPullFailure): void {
  try {
    const detail = describeDocumentPullError(error);
    console.error(JSON.stringify({
      source: 'freeflow',
      event: 'document_pull_error',
      errorName: detail.errorName,
      ...(detail.prismaCode ? { prismaCode: detail.prismaCode } : {}),
      ...(detail.postgresCode ? { postgresCode: detail.postgresCode } : {}),
      safeCode: classified.safeCode,
      retryable: classified.retryable,
      message: detail.message,
    }));
  } catch {
    console.error(JSON.stringify({
      source: 'freeflow',
      event: 'document_pull_error',
      errorName: 'UnknownError',
      safeCode: classified.safeCode,
    }));
  }
}

/** A unique conflict was recovered inside the persist transaction. No row data is logged. */
export function logDocumentPullPersistRecovery(error: unknown): void {
  try {
    const prismaCode = readPrismaCode(error);
    const postgresCode = readPostgresCode(error);
    console.info(JSON.stringify({
      source: 'freeflow',
      event: 'document_pull_persist_recovered',
      ...(prismaCode ? { prismaCode } : {}),
      ...(postgresCode ? { postgresCode } : {}),
    }));
  } catch {
    // Recovery logging must not change the persist outcome.
  }
}

export function describeDocumentPullError(error: unknown): Readonly<{
  errorName: string;
  prismaCode?: string;
  postgresCode?: string;
  message: string;
}> {
  const errorName = error instanceof Error && ERROR_NAME.test(error.name) ? error.name : 'UnknownError';
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return {
    errorName,
    ...(readPrismaCode(error) ? { prismaCode: readPrismaCode(error) } : {}),
    ...(readPostgresCode(error) ? { postgresCode: readPostgresCode(error) } : {}),
    message: redactOperationalMessage(raw),
  };
}

export function redactOperationalMessage(value: string): string {
  // Prisma dumps the query arguments between the invocation line and the
  // short driver summary. Keep the summary lines and drop payload lines.
  const lines = value.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isPayloadLine(line))
    .slice(0, 3);
  let text = lines.join(' ').slice(0, 400);
  text = text.replace(/%PDF[\s\S]*/g, REDACTED);
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED);
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, REDACTED);
  text = text.replace(/\b(?:Bearer|Basic)\s+\S+/gi, REDACTED);
  text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, REDACTED);
  text = text.replace(/\b[A-Z][A-Z0-9_]{2,}=\S+/g, REDACTED);
  text = text.replace(/(?:password|secret|token|authorization|api[_-]?key|signature)\s*[:=]\s*\S+/gi, REDACTED);
  text = text.replace(/\b[0-9a-f]{32,}\b/gi, REDACTED);
  text = text.replace(/"(?:[^"\\]|\\.)*"/g, '"[redacted]"');
  text = text.replace(/'(?:[^'\\]|\\.)*'/g, "'[redacted]'");
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 240);
}

function readPrismaCode(error: unknown, depth = 0): string | undefined {
  if (depth > 3 || !isRecord(error)) return undefined;
  if (typeof error.code === 'string' && PRISMA_CODE.test(error.code)) return error.code;
  return readPrismaCode(error.cause, depth + 1);
}

function readPostgresCode(error: unknown, depth = 0): string | undefined {
  if (depth > 3 || !isRecord(error)) return undefined;
  if (isRecord(error.meta) && typeof error.meta.code === 'string' && POSTGRES_CODE.test(error.meta.code)) {
    return error.meta.code;
  }
  if (typeof error.message === 'string') {
    const match = error.message.match(/\b([0-9]{2}[0-9A-Z]{3})\b/);
    if (match && POSTGRES_CODE.test(match[1]!)) return match[1];
  }
  return readPostgresCode(error.cause, depth + 1);
}

function isPayloadLine(line: string): boolean {
  return line.startsWith('{')
    || line.startsWith('}')
    || line.startsWith('[')
    || line.startsWith(']')
    || line.startsWith('"')
    || line.startsWith("'")
    || line.startsWith('at ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
