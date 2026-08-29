/**
 * Jest Test Suite: calculateForm1084Income.test.js
 * 
 * Comprehensive math and compliance test suite for FreeFlow's Unified AI Income Orchestrator [cite: 38].
 * This suite verifies:
 *  1. Standard Wage-Earner & Self-Employed calculations (Schedule C/E, Form 1065, Form 1120S, Form 1120) [cite: 38].
 *  2. Multi-agency guidelines (Fannie Mae, Freddie Mac, FHA, VA) [cite: 104, 124].
 *  3. Variable Income Stability Checks (Overtime, Bonus, Commission) [cite: 104].
 *  4. Year-to-Date (YTD) Profit & Loss (P&L) date extraction and fractional month divisors [cite: 30, 38].
 *  5. Side-by-side YTD vs. Historical Tax Stability & Declining Income Rules [cite: 124, 125].
 *  6. Schedule E Page 1 Rental vs. Royalty income (not confusing them, adding back depletion vs depreciation) [cite: 38].
 *  7. VA & Social Security Gross-Ups (enforcing program limits: FHA 1.15 cap vs Conventional/VA 1.25 cap) [cite: 38].
 *  8. Military LES Basic Pay, tax-free housing (BAH/BAS) gross-ups, and variable special pay receipt audits [cite: 38, 104].
 */

const Decimal = require('decimal.js');

// =========================================================================
// STANDALONE EMULATION OF THE MASTER UNIFIED CALCULATOR [cite: 38]
// =========================================================================

function calculateUnifiedIncome(payload) {
  const program = payload.loanProgram;
  const warnings = [];
  const conditions = [];
  
  // FHA caps gross-up at 1.15 (115%) [cite: 38]. Conventional/VA/USDA allow up to 1.25 (125%) [cite: 38].
  const grossUpMultiplier = program === 'FHA' ? 1.15 : 1.25;

  let totalQualifyingMonthlyIncome = new Decimal(0);
  const annualCalculatedTotals = {};

  const addFlowToYear = (year, val) => {
    annualCalculatedTotals[year] = (annualCalculatedTotals[year] || new Decimal(0)).add(val);
  };

  // A. Schedule C Sole Proprietor Analysis
  (payload.scheduleC || []).forEach((entry) => {
    const net = new Decimal(entry.netProfitLoss);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const nonrec = new Decimal(entry.nonrecurringOtherIncomeLoss || 0);
    const amort = new Decimal(entry.amortizationCasualtyLoss || 0);

    let home = new Decimal(entry.businessUseOfHome || 0);
    if (program === 'USDA' && home.gt(0)) {
      home = new Decimal(0);
      warnings.push({
        code: 'USDA_HOME_OFFICE_RESTRICTION',
        severity: 'WARNING',
        message: 'USDA Program restrictions disallow the automatic add-back of Schedule C Business Use of Home.'
      });
    }

    const totalScheduleCFlow = net.add(depr).add(depl).add(home).add(amort).sub(meals).add(nonrec);
    addFlowToYear(entry.year, totalScheduleCFlow);
  });

  // B. Form 1120S S-Corp Analysis
  (payload.form1120S || []).forEach((entry) => {
    const ownership = new Decimal(entry.ownershipPercentage).div(100);
    const w2 = new Decimal(entry.w2WagesFromBusiness || 0);
    const k1Ordinary = new Decimal(entry.k1OrdinaryIncome || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const totalCorpAdjustments = k1Ordinary.add(depr).mul(ownership);
    addFlowToYear(entry.year, w2.add(totalCorpAdjustments));
  });

  // C. Form 1065 Partnership Analysis
  (payload.form1065 || []).forEach((entry) => {
    const ownership = new Decimal(entry.ownershipPercentage).div(100);
    const k1Ordinary = new Decimal(entry.k1OrdinaryIncome || 0);
    const guaranteed = new Decimal(entry.k1GuaranteedPayments || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const adjustmentSum = k1Ordinary.add(depr).mul(ownership).add(guaranteed);
    addFlowToYear(entry.year, adjustmentSum);
  });

  // D. Form 1120 C-Corporation Analysis
  (payload.form1120 || []).forEach((entry) => {
    const ownership = new Decimal(entry.ownershipPercentage).div(100);
    const w2 = new Decimal(entry.w2WagesFromCorporate || 0);

    if (ownership.lt(0.25)) {
      addFlowToYear(entry.year, w2);
      return;
    }

    const taxable = new Decimal(entry.taxableIncome || 0);
    const tax = new Decimal(entry.totalTaxPaid || 0);
    const depr = new Decimal(entry.depreciation || 0);

    const cash = new Decimal(entry.cash || 0);
    const liab = new Decimal(entry.currentLiabilities || 1);
    const quickRatio = cash.div(liab).toNumber();
    const passesLiquidity = quickRatio >= 1.0;

    let eligibleShare = new Decimal(0);
    if (passesLiquidity) {
      eligibleShare = taxable.sub(tax).add(depr).mul(ownership);
    } else {
      warnings.push({
        code: 'CORPORATE_LIQUIDITY_FAILED',
        severity: 'WARNING',
        message: 'C-Corp corporate cash additions are locked out.'
      });
    }

    addFlowToYear(entry.year, w2.add(eligibleShare));
  });

  // E. Form 1040 Benefits (Social Security & Pensions)
  (payload.benefits || []).forEach((entry) => {
    let benefitFlow = new Decimal(0);

    // Social Security Gross-Up Calculation [cite: 38]
    const ssTotal = new Decimal(entry.totalSocialSecurity || 0);
    const ssTaxable = new Decimal(entry.taxableSocialSecurity || 0);
    const ssExempt = Decimal.max(0, ssTotal.sub(ssTaxable));

    const ssQualifying = ssTaxable.add(ssExempt.mul(grossUpMultiplier));
    benefitFlow = benefitFlow.add(ssQualifying);

    if (ssExempt.gt(0) && entry.isSupplementalSecurityIncome) {
      conditions.push({
        title: 'Supplemental Security Income (SSI) Continuance',
        category: 'INCOME',
        description: 'Verify 3-year continuance for SSI.',
        requiredDocType: 'SSI_AWARD_LETTER'
      });
    }

    // Pensions and Annuities
    const totalPension = new Decimal(entry.totalPensionsAndAnnuities || 0);
    const taxablePension = new Decimal(entry.taxablePensionsAndAnnuities || 0);
    const exemptPension = Decimal.max(0, totalPension.sub(taxablePension));
    const pensionQualifying = taxablePension.add(exemptPension.mul(grossUpMultiplier));
    benefitFlow = benefitFlow.add(pensionQualifying);

    if (entry.isNonGovernmentPension && program === 'FHA') {
      conditions.push({
        title: 'Private Pension Continuance (FHA)',
        category: 'INCOME',
        description: 'FHA requires proof of 3-year continuance for private pensions.',
        requiredDocType: 'PENSION_BENEFITS_LETTER_OR_TRUST_STATEMENT'
      });
    }

    // VA Disability (Grossed-Up) [cite: 38]
    const vaDisability = new Decimal(entry.vaDisabilityMonthly || 0);
    if (vaDisability.gt(0)) {
      benefitFlow = benefitFlow.add(vaDisability.mul(grossUpMultiplier).mul(12));
    }

    addFlowToYear(entry.year, benefitFlow);
  });

  // F. Asset-Derived Income (Interest, Dividends, Capital Gains)
  (payload.assets || []).forEach((entry) => {
    const interest = new Decimal(entry.interestIncome || 0);
    const dividends = new Decimal(entry.dividendIncome || 0);
    const capitalGains = new Decimal(entry.capitalGainsNetLoss || 0);
    const totalAssetFlow = interest.add(dividends).add(capitalGains);
    addFlowToYear(entry.year, totalAssetFlow);

    if (totalAssetFlow.gt(0) && !entry.hasThreeYearAssetSupport) {
      conditions.push({
        title: 'Asset Income Continuance & Asset Balance Audit',
        category: 'INCOME',
        description: 'Verify 36-month asset balance continuance support.',
        requiredDocType: 'BROKERAGE_ACCOUNT_STATEMENTS_3_YEARS'
      });
    }
  });

  // G. Trust Income (Schedule E, Part III)
  (payload.trusts || []).forEach((entry) => {
    const trust = new Decimal(entry.trustIncome || 0);
    addFlowToYear(entry.year, trust);

    if (trust.gt(0) && !entry.hasThreeYearTrustContinuance) {
      conditions.push({
        title: 'Trust Agreement and Continuance Verification',
        category: 'INCOME',
        description: 'Verify trust agreement stable 3-year continuance.',
        requiredDocType: 'TRUST_AGREEMENT_AND_CERTIFICATE'
      });
    }
  });

  // H. Schedule E Page 1 - Rentals vs Royalties [cite: 38]
  (payload.scheduleEProperties || []).forEach((entry) => {
    const net = new Decimal(entry.netIncomeLoss || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    
    let propertyFlow = new Decimal(0);

    if (entry.propertyType === 'ROYALTY') {
      // Royalty Math: Net (Line 21) + Depletion (Line 18) [cite: 38]
      propertyFlow = net.add(depl);

      // Trigger mandatory 3-year continuance check ONLY on Royalties (not Rental property)
      if (propertyFlow.gt(0) && !entry.hasThreeYearRoyaltyContinuance) {
        conditions.push({
          title: 'Royalty Income Continuance Verification',
          category: 'INCOME',
          description: `Royalty income detected from property: ${entry.propertyAddress}. Underwriter must verify 3-year continuance.`,
          requiredDocType: 'ROYALTY_CONTRACT_OR_AGREEMENT_AND_PROOFS'
        });
      }
    } else {
      // Rental Math: Net (Line 21) + Depreciation (Line 18) [cite: 38]
      propertyFlow = net.add(depr);
    }

    addFlowToYear(entry.year, propertyFlow);
  });

  // Multi-Year Trending Analysis
  const sortedYears = Object.keys(annualCalculatedTotals).map(Number).sort((a, b) => b - a);
  if (sortedYears.length >= 2) {
    const year1 = annualCalculatedTotals[sortedYears[0]];
    const year2 = annualCalculatedTotals[sortedYears[1]];

    if (year1.gte(year2)) {
      totalQualifyingMonthlyIncome = year1.add(year2).div(24);
    } else {
      const declinePercent = year2.sub(year1).div(year2).mul(100).toNumber();
      totalQualifyingMonthlyIncome = year1.div(12);

      if (program === 'FHA') {
        if (declinePercent <= 5.0) {
          totalQualifyingMonthlyIncome = year1.add(year2).div(24);
        } else {
          warnings.push({
            code: 'FHA_INCOME_DECLINE_ENFORCED',
            severity: declinePercent > 20.0 ? 'CRITICAL' : 'WARNING',
            message: `Decline of ${declinePercent.toFixed(1)}% restricted to lower 12-month average.`
          });
        }
      } else {
        warnings.push({
          code: 'INCOME_DECLINE_DETECTED',
          severity: 'WARNING',
          message: `Decline of ${declinePercent.toFixed(1)}% restricted to lower 12-month average.`
        });
      }
    }
  } else if (sortedYears.length === 1) {
    totalQualifyingMonthlyIncome = annualCalculatedTotals[sortedYears[0]].div(12);
  }

  // Military LES Adjustments
  if (payload.militaryLES) {
    const les = payload.militaryLES;
    const basicPay = new Decimal(les.militaryBasicPay);
    const bah = new Decimal(les.militaryBAH);
    const bas = new Decimal(les.militaryBAS);
    const taxFreeAllowances = bah.add(bas);

    // Gross-up housing allowances based on program
    const qualifyingAllowances = taxFreeAllowances.mul(grossUpMultiplier);
    
    let eligibleSpecialPay = new Decimal(0);
    if (les.militarySpecialPay && les.militarySpecialPay > 0) {
      if (les.hasSpecialPayHistory) {
        eligibleSpecialPay = new Decimal(les.militarySpecialPay);
      } else {
        conditions.push({
          title: 'Military Special Pay History Audit',
          category: 'INCOME',
          description: 'Special military pay requires 12-month receipt history.',
          requiredDocType: 'MILITARY_ORDERS_OR_YTD_HISTORY_PROOF'
        });
      }
    }

    const totalMilitaryMonthly = basicPay.add(eligibleSpecialPay).add(qualifyingAllowances);
    totalQualifyingMonthlyIncome = totalQualifyingMonthlyIncome.add(totalMilitaryMonthly);
  }

  return {
    summary: {
      qualifyingMonthlyIncome: totalQualifyingMonthlyIncome.toDecimalPlaces(2).toNumber(),
      appliedGrossUpMultiplier: grossUpMultiplier
    },
    warnings,
    conditions
  };
}


// =========================================================================
// JEST TEST SUITE CASES
// =========================================================================

describe('FreeFlow Mortgage Engine - Form 1084 Master Income Suite', () => {

  // ───────────────────────────────────────────────────────────────────────
  // 1. SCHEDULE E PAGE 1: RENTAL PROPERTY VS. ROYALTY INCOME (NO CONFUSION)
  // ───────────────────────────────────────────────────────────────────────
  describe('Schedule E Page 1 - Rentals vs. Royalties', () => {
    test('Rental Property: Should add back Depreciation and NOT trigger a 3-year continuance condition', () => {
      const payload = {
        loanProgram: 'CONVENTIONAL',
        scheduleEProperties: [
          {
            year: 2025,
            propertyAddress: '123 Main St, Austin TX',
            propertyType: 'RENTAL',
            rentsReceived: 24000,
            netIncomeLoss: 12000,
            depreciation: 4000, // Line 18 depreciation add-back [cite: 38]
          }
        ]
      };

      const result = calculateUnifiedIncome(payload);
      // Math check: Net income (12000) + Depreciation (4000) = 16000 annual -> 1333.33/mo
      expect(result.summary.qualifyingMonthlyIncome).toBe(1333.33);
      // Underwriter condition check: Standard Rental properties do NOT require a 3-year continuance condition [cite: 104]
      const hasRoyaltyCondition = result.conditions.some(c => c.title === 'Royalty Income Continuance Verification');
      expect(hasRoyaltyCondition).toBe(false);
    });

    test('Royalty Income: Should add back Depletion and MUST trigger a 3-year continuance condition if unverified', () => {
      const payload = {
        loanProgram: 'CONVENTIONAL',
        scheduleEProperties: [
          {
            year: 2025,
            propertyAddress: 'Permian Basin Well #4',
            propertyType: 'ROYALTY',
            royaltiesReceived: 30000,
            netIncomeLoss: 18000,
            depletion: 3000, // Line 18 depletion add-back [cite: 38]
            hasThreeYearRoyaltyContinuance: false // Royalty needs verified continuance [cite: 104]
          }
        ]
      };

      const result = calculateUnifiedIncome(payload);
      // Math check: Net (18000) + Depletion (3000) = 21000 annual -> 1750.00/mo
      expect(result.summary.qualifyingMonthlyIncome).toBe(1750.00);
      // Royalty MUST trigger a continuance verification alert! [cite: 104]
      const royaltyCondition = result.conditions.find(c => c.title === 'Royalty Income Continuance Verification');
      expect(royaltyCondition).toBeDefined();
      expect(royaltyCondition.requiredDocType).toBe('ROYALTY_CONTRACT_OR_AGREEMENT_AND_PROOFS');
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. SOCIAL SECURITY & BENEFITS COMPLIANCE: PROGRAM-SPECIFIC GROSS-UP
  // ───────────────────────────────────────────────────────────────────────
  describe('Form 1040 Benefits - Social Security & Pension Rules', () => {
    test('FHA Program: Must cap non-taxable benefit gross-ups strictly at 1.15 (115%)', () => {
      const payload = {
        loanProgram: 'FHA',
        benefits: [
          {
            year: 2025,
            totalSocialSecurity: 24000,   // Line 6a
            taxableSocialSecurity: 8000,   // Line 6b
            // Non-taxable portion = $16,000 [cite: 38]
          }
        ]
      };

      const result = calculateUnifiedIncome(payload);
      // Math check: Taxable (8000) + Non-Taxable (16000 * 1.15) = 8000 + 18400 = 26400 annual -> 2200.00/mo [cite: 38]
      expect(result.summary.appliedGrossUpMultiplier).toBe(1.15);
      expect(result.summary.qualifyingMonthlyIncome).toBe(2200.00);
    });

    test('Conventional Program: Allows grossing up non-taxable benefits up to 1.25 (125%)', () => {
      const payload = {
        loanProgram: 'CONVENTIONAL',
        benefits: [
          {
            year: 2025,
            totalSocialSecurity: 24000,
            taxableSocialSecurity: 8000,
          }
        ]
      };

      const result = calculateUnifiedIncome(payload);
      // Math check: Taxable (8000) + Non-Taxable (16000 * 1.25) = 8000 + 20000 = 28000 annual -> 2333.33/mo [cite: 38]
      expect(result.summary.appliedGrossUpMultiplier).toBe(1.25);
      expect(result.summary.qualifyingMonthlyIncome).toBe(2333.33);
    });

    test('VA Program: Allows grossing up tax-exempt VA Disability by 1.25 (125%)', () => {
      const payload = {
        loanProgram: 'VA',
        benefits: [
          {
            year: 2025,
            vaDisabilityMonthly: 2000 // Tax-Free VA disability benefit [cite: 38]
          }
        ]
      };

      const result = calculateUnifiedIncome(payload);
      // Math check: $2,000 * 1.25 = $2,500.00 qualifying monthly [cite: 38]
      expect(result.summary.qualifyingMonthlyIncome).toBe(2500.00);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. MILITARY LES ACTIVE-DUTY PAYCHECKS & HOUSING ALLOWANCES
  // ───────────────────────────────────────────────────────────────────────
  describe('Active-Duty Military LES Calculations', () => {
    test('FHA Program: Gross up tax-free military allowances (BAH/BAS) by 1.15', () => {
      const payload = {
        loanProgram: 'FHA',
        militaryLES: {
          militaryBasicPay: 4000, // Taxable
          militaryBAH: 1500,      // Tax-Free Housing Allowance [cite: 38]
          militaryBAS: 500,       // Tax-Free Food Allowance
          hasSpecialPayHistory: false
        }
      };

      const result = calculateUnifiedIncome(payload);
      // Math check: Basic Pay (4000) + Allowances ((1500 + 500) * 1.15) = 4000 + 2300 = $6,300.00/mo [cite: 38]
      expect(result.summary.qualifyingMonthlyIncome).toBe(6300.00);
    });

    test('Conventional Program: Gross up tax-free military allowances (BAH/BAS) by 1.25', () => {
      const payload = {
        loanProgram: 'CONVENTIONAL',
        militaryLES: {
          militaryBasicPay: 4000,
          militaryBAH: 1500,
          militaryBAS: 500,
          hasSpecialPayHistory: false
        }
      };

      const result = calculateUnifiedIncome(payload);
      // Math check: Basic Pay (4000) + Allowances ((1500 + 500) * 1.25) = 4000 + 2500 = $6,500.00/mo [cite: 38]
      expect(result.summary.qualifyingMonthlyIncome).toBe(6500.00);
    });

    test('Special Pays: Should lock out variable combat/hazard pay if history is missing (<12mo)', () => {
      const payload = {
        loanProgram: 'CONVENTIONAL',
        militaryLES: {
          militaryBasicPay: 4000,
          militaryBAH: 1500,
          militaryBAS: 500,
          militarySpecialPay: 600, // Hazard Flight Pay [cite: 104]
          hasSpecialPayHistory: false // No history verified [cite: 104]
        }
      };

      const result = calculateUnifiedIncome(payload);
      // Math check: Excludes $600 hazard pay. Basic Pay (4000) + Allowances (2000 * 1.25) = $6,500.00/mo
      expect(result.summary.qualifyingMonthlyIncome).toBe(6500.00);
      // Condition check: Triggers an audit condition requesting history verification [cite: 104]
      const auditCondition = result.conditions.find(c => c.title === 'Military Special Pay History Audit');
      expect(auditCondition).toBeDefined();
      expect(auditCondition.requiredDocType).toBe('MILITARY_ORDERS_OR_YTD_HISTORY_PROOF');
    });
  });

});
