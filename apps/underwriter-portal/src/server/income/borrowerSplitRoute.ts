import type { NextApiRequest, NextApiResponse } from 'next';
import { ZodError } from 'zod';
import {
  calculateBorrowerIncome,
  parseBorrowerIncomeRequest,
  type BorrowerIncomeResult,
} from '@mortgage-pos/mortgage-engine';
import type { RequestContext } from '../auth/requestContext';
import { hashCanonical } from '../http/canonical';

const MAX_ISSUES = 20;

type Dependencies = Readonly<{
  calculate: typeof calculateBorrowerIncome;
}>;

export type BorrowerSplitResponse = BorrowerIncomeResult & Readonly<{
  requestId: string;
  /** SHA-256 of the validated request, defaults filled, in canonical key order. */
  inputHash: string;
}>;

/**
 * Stateless per-borrower income split for callers that hold their own loan
 * file (Mortgage-POS). Nothing is read from or written to the database, and
 * the request body is not logged; callers keep `inputHash` and `requestId`
 * with their own record of the calculation.
 */
export function createBorrowerSplitHandler(dependencies: Dependencies = { calculate: calculateBorrowerIncome }) {
  return async function handler(req: NextApiRequest, res: NextApiResponse, context: RequestContext) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: safeError('METHOD_NOT_ALLOWED', 'Only POST is supported.', context) });
    }
    let parsed;
    try {
      parsed = parseBorrowerIncomeRequest(req.body);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: {
            ...safeError('INVALID_BORROWER_INCOME_REQUEST', 'The borrower income request failed validation.', context),
            issues: error.issues.slice(0, MAX_ISSUES).map((issue) => ({ path: issue.path, message: issue.message })),
          },
        });
      }
      throw error;
    }
    try {
      const inputHash = hashCanonical(JSON.parse(JSON.stringify(parsed)));
      const result = dependencies.calculate(parsed);
      const body: BorrowerSplitResponse = { ...result, requestId: context.requestId, inputHash };
      return res.status(200).json(body);
    } catch {
      return res.status(500).json({
        error: safeError('BORROWER_INCOME_CALCULATION_FAILED', 'The borrower income calculation failed.', context),
      });
    }
  };
}

function safeError(code: string, message: string, context: RequestContext) {
  return { code, message, requestId: context.requestId };
}
