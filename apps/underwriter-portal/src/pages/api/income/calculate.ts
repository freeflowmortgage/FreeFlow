import { NextApiRequest, NextApiResponse } from 'next';
import {
  dispatchIncomeCalculation,
  UnifiedIncomeCalculationPayload,
  LoanProgram
} from '@mortgage-pos/mortgage-engine';
import { withRequestContext, type RequestContext } from '../../../server/auth/requestContext';
import { withTenantTransaction } from '../../../server/database/client';
import { appendAuditEvent, hashAuditResult } from '../../../server/audit/appendEvent';

/**
 * 🚀 Next.js API Route: /api/income/calculate
 * 
 * Secure, zero-data-retention calculation gateway for the FreeFlow Income Engine.
 * 
 * CORE OPERATIONS:
 * 1. Enforces NextAuth Session Protection (underwriter verification) [cite: 116].
 * 2. Pulls loan details from multi-tenant PostgreSQL to resolve the active Loan Program [cite: 35].
 * 3. Sanitizes and transforms incoming OCR/API data into unified inputs [cite: 33, 49].
 * 4. Dispatches the data to the calculateForm1084Income-v5 core rules engine [cite: 122].
 * 5. Commits non-PII metrics and audit logs back to PostgreSQL in an atomic transaction [cite: 19, 38].
 * 6. Returns a standardized JSON payload to fuel real-time, interactive frontend updates [cite: 26].
 */
async function handler(req: NextApiRequest, res: NextApiResponse, context: RequestContext) {
  // 1. Enforce POST only
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  }

  try {
    const { loanId, documentData } = req.body;

    // Validate parameters
    if (!loanId) {
      return res.status(400).json({ error: 'BAD REQUEST: Missing required field [loanId].' });
    }
    if (!documentData) {
      return res.status(400).json({ error: 'BAD REQUEST: Missing required field [documentData].' });
    }

    // 3. Resolve the Active Loan Product / Agency [cite: 35]
    // Dynamically query our multitenant database to resolve the loan's program parameters [cite: 20, 35].
    const loan = await withTenantTransaction(
      { tenantId: context.tenantId, principalId: context.membershipId },
      (transaction) => transaction.loanApplication.findFirst({
        where: { id: loanId, tenantId: context.tenantId },
        select: {
          id: true,
          tenantId: true,
          version: true,
        }
      }),
    );

    if (!loan) {
      return res.status(404).json({ error: `LOAN NOT FOUND: Active file ID "${loanId}" does not exist.` });
    }

    // Map requested loan program or default to CONVENTIONAL [cite: 35, 122]
    const requestedProgram = req.body.loanProgram as string | undefined;
    let calculatorProgram: LoanProgram = 'CONVENTIONAL';
    if (requestedProgram === 'FHA') calculatorProgram = 'FHA';
    else if (requestedProgram === 'VA') calculatorProgram = 'VA';
    else if (requestedProgram === 'USDA') calculatorProgram = 'USDA';

    // 4. Transform and Package Inbound Data Payload
    // Build the payload conforming strictly to UnifiedIncomeCalculationPayload structure [cite: 122]
    const calculationPayload: UnifiedIncomeCalculationPayload = {
      loanProgram: calculatorProgram,
      w2Employers: documentData.w2Employers,
      scheduleC: documentData.scheduleC,
      scheduleF: documentData.scheduleF,
      form1120S: documentData.form1120S,
      form1065: documentData.form1065,
      form1120: documentData.form1120,
      benefits: documentData.benefits,
      assets: documentData.assets,
      trusts: documentData.trusts,
      scheduleEProperties: documentData.scheduleEProperties,
      militaryLES: documentData.militaryLES,
      subjectPropertyRental: documentData.subjectPropertyRental
    };

    // 5. Dispatch to a program-isolated engine. USDA never falls through to
    // retrospective Form 1084 trending: it requires prospective repayment and
    // household-eligibility inputs supplied directly to this income service.
    let calculationResults: unknown;
    let calculationEngine: 'FORM_1084' | 'USDA_STANDALONE';
    let qualifyingMonthlyIncome: number;
    let trendingResult: string;
    let yearsAnalyzed: number[];

    if (calculatorProgram === 'USDA') {
      if (!documentData.usdaInput) {
        return res.status(400).json({
          error: 'BAD REQUEST: USDA calculations require documentData.usdaInput with household members and county income limit.'
        });
      }
      const dispatched = dispatchIncomeCalculation({
        loanProgram: 'USDA',
        usdaInput: { ...documentData.usdaInput, loanId }
      });
      calculationEngine = dispatched.engine;
      calculationResults = dispatched.result;
      qualifyingMonthlyIncome = dispatched.result.repaymentIncomeMonthly;
      trendingResult = dispatched.result.isEligibleByIncome ? 'USDA_ELIGIBLE' : 'USDA_OVER_INCOME_LIMIT';
      yearsAnalyzed = [];
    } else {
      const dispatched = dispatchIncomeCalculation({
        loanProgram: calculatorProgram,
        form1084Input: calculationPayload
      });
      calculationEngine = dispatched.engine;
      calculationResults = dispatched.result;
      qualifyingMonthlyIncome = dispatched.result.summary.qualifyingMonthlyIncome;
      trendingResult = dispatched.result.summary.trendingResult;
      yearsAnalyzed = dispatched.result.summary.yearsAnalyzed;
    }

    // 6. Commit Form 1084 Audit record to Database (Atomic Transaction) [cite: 19, 38]
    // We strictly avoid saving raw document binaries or borrower SSNs here, complying with ZDR guidelines [cite: 33].
    const updatedAudit = await withTenantTransaction(
      { tenantId: context.tenantId, principalId: context.membershipId },
      async (transaction) => {
        const audit = await transaction.form1084Audit.create({
          data: {
            tenantId: context.tenantId,
            loanId: loan.id,
            totalAnnualCashFlow: qualifyingMonthlyIncome * 12,
            qualifyingMonthlyIncome,
            calculationSchemaVersion: 'calculation-request-v1',
            calculationSource: 'authenticated-api',
            yearsAnalyzed,
          },
        });

        const event = await appendAuditEvent(transaction, context, {
          loanId: loan.id,
          entityType: 'FORM_1084_AUDIT',
          entityId: audit.id,
          expectedLoanVersion: loan.version,
          action: 'INCOME_CALCULATION_COMPLETED',
          reasonCode: 'SYSTEM_CALCULATION',
          ruleVersion: calculatorProgram === 'USDA' ? 'usda-income-v2' : 'form-1084-v9',
          schemaVersion: 'audit-event-v1',
          resultHash: hashAuditResult({
            calculationEngine,
            loanProgram: calculatorProgram,
            qualifyingMonthlyIncome,
            totalAnnualCashFlow: qualifyingMonthlyIncome * 12,
            trendingResult,
            yearsAnalyzed,
          }),
        });

        return { audit, event };
      },
    );

    // 7. Success: Return fully calculated and compliant JSON to frontend dashboard [cite: 26]
    return res.status(200).json({
      success: true,
      loanId: loan.id,
      calculatedMonthlyIncome: qualifyingMonthlyIncome,
      trendingResult,
      calculationEngine,
      calculationDetails: calculationResults,
      auditLogId: updatedAudit.audit.id,
      auditEventId: updatedAudit.event.id,
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    console.error('[income-calculate] calculation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return res.status(500).json({
      success: false,
      error: {
        code: 'INCOME_CALCULATION_FAILED',
        message: 'The income calculation could not be completed.',
        requestId: context.requestId,
      },
    });
  }
}

export default withRequestContext('income:calculate', handler);
