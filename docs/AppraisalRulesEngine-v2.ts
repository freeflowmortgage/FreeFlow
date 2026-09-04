/**
 * MORTGAGE POINT OF SALE - COGNITIVE APPRAISAL VALIDATION ENGINE (v2)
 * =============================================================================
 * This core module implements deterministic collateral validation rules mapping:
 *  - FHA HUD Handbook 4000.1 (including Manufactured, Lead Paint, CCDE Form 92800.5-B)
 *  - VA Pamphlet 26-7 Chapter 12 (Notice of Value MPRs)
 *  - GSE Selling Guides (Collateral Underwriter, Net/Gross adjustments)
 *  - Commentary Red Flag Keyword Scraper (Mold, Dampness, Structural Integrity, etc.)
 *  - FHA 90/180-Day Flip Rules & Non-Arm's Length Transaction Checks
 *  - Matrix-Level Comparable Grid Auditing (Page 2 URAR & Supplemental Pages)
 * =============================================================================
 */

import { Decimal } from 'decimal.js';

export type HousingProgram = 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
export type PropertyType = 'SINGLE_FAMILY' | 'CONDO' | 'MULTI_FAMILY' | 'MANUFACTURED';
export type OwnershipType = 'FEE_SIMPLE' | 'LEASEHOLD';
export type SolarOwnership = 'OWNED' | 'LEASED' | 'PPA' | 'UNKNOWN';

export interface SpatialCoordinates {
  pageIndex: number;
  box: [number, number, number, number]; // [x, y, width, height] relative ratios
}

export interface ComparableCellCoordinate {
  compIndex: number;
  field: string; // e.g. 'salePrice', 'proximity', 'net_adjustments', 'gross_adjustments', 'GLA', 'Site', etc.
  pageIndex: number;
  box: [number, number, number, number];
}

export interface AppraisalRecord {
  // Administrative Header
  caseNumber: string;
  expectedCaseNumber: string; // From Loan File
  intendedUse: string;
  highestAndBestUse: boolean;
  ownershipType: OwnershipType;
  remainingLeaseTermYears?: number;
  loanMaturityDate: Date;
  yearBuilt: number;

  // Transaction Contract Section (Page 1 URAR / Contract Review)
  isPurchaseTransaction: boolean;
  contractSalesPrice: number;
  sellerIsOwnerOfRecord: boolean;
  isNonArmsLengthTransaction: boolean; // Flag if buyer/seller are related or have business ties
  priorSaleDate?: Date;                // Prior deed transfer date
  priorSalePrice?: number;              // Prior deed sale price
  currentContractDate: Date;            // Execution date of current purchase agreement

  // Property Taxonomy
  propertyType: PropertyType;
  isManufacturedHousing: boolean;
  hudCertificationPlatesPresent?: boolean; // Required for FHA Manufactured
  hudDataPlatePresent?: boolean;          // Required for FHA Manufactured
  hasFoundationEngineersCertificate?: boolean; // Mandatory for FHA/VA Manufactured

  // Solar & Energy Systems (FHA Handbook 4000.1 & VA Chapter 12 Overlays)
  hasSolarPanels: boolean;
  solarOwnershipType?: SolarOwnership;
  solarSystemIsLeased: boolean;
  solarSystemContributoryValueAdjustment: number;
  solarAppraisalValueAdjustmentIncluded?: boolean; // True if appraiser included solar system in value
  solarAgreementContainsTransferRestrictions?: boolean;
  solarLeasePaymentsIncludedInDti?: boolean;
  solarLeaseTransferRestrictionsPresent?: boolean;
  solarLeasePaymentImpactsDti?: boolean;

  // Physical Visual Inspections & Safety (HUD 4000.1 / VA Chapter 12)
  atticInspected: boolean;
  crawlspaceInspected: boolean;
  utilitiesAreActive: boolean;
  septicWellVisualInspectionNoted: boolean;
  peelingPaintDetected: boolean;
  termiteActiveInfestationDetected: boolean;
  wellWaterPotabilityTestCleared?: boolean;

  // Appraiser Commentary Text Blocks (For Keyword Red-Flag Scrapes)
  neighborhoodCommentary: string;
  physicalConditionCommentary: string;
  comparablesCommentary: string;
  reconciliationCommentary: string;

  // Market Conditions (1004MC Cross-Validation)
  neighborhoodTrend: 'INCREASING' | 'STABLE' | 'DECLINING';
  mcMedianPriceCurrentQuarter: number;
  mcMedianPricePriorYearQuarter: number;
  mcMonthsSupplyCurrentQuarter: number;

  // Comparables Grid Metrics
  comparables: Array<{
    compIndex: number; // Comp 1, Comp 2, Comp 3, Comp 4 (on supplementary pages), etc.
    salePrice: number;
    proximityMiles: number;
    netAdjustmentAmount: number;
    grossAdjustmentAmount: number;
    individualLineItemAdjustments: Array<{ 
      field: string; 
      amount: number;
      coordinates?: SpatialCoordinates; // Bounding box for that specific cell
    }>;
    // Multi-Page Coordinate Dictionary
    cellCoordinates?: Record<string, ComparableCellCoordinate>;
  }>;
}

export interface ActionItemToAddress {
  id: string;
  code: string;
  category: 'REPAIR' | 'INSPECTION' | 'ADMIN' | 'CRITICAL_DISCREPANCY' | 'LEGAL_REVIEW';
  severity: 'CRITICAL_ERROR' | 'WARNING' | 'COMPLIANCE_INFO';
  description: string;
  sourceAuthority: 'FHA_HUD_4000_1' | 'VA_PAM_26_7_CH12' | 'FANNIE_MAE_SEL_GUIDE' | 'COMPLIANCE_GENERAL';
  coordinates?: SpatialCoordinates; // Targets PDF coordinates for front-end highlights
  autoPrefillNovConditionText?: string; // Text to inject into the VA Notice of Value
  autoPrefillCcdeConditionText?: string; // Text to inject into FHA Form 92800.5-B
  isCleared: boolean;
}

export class AppraisalRulesEngine {
  /**
   * Evaluates an extracted appraisal record against agency guidelines.
   * Compiles and outputs actionable tasks and auto-prefilled condition cards.
   * Implements matrix-level spatial targeting across primary and supplementary comps.
   */
  public static evaluateAppraisal(appraisal: AppraisalRecord, program: HousingProgram): ActionItemToAddress[] {
    const items: ActionItemToAddress[] = [];
    const timestamp = Date.now();

    // ---------------------------------------------------------------------------------
    // SECTION 1: COMMENTARY RED-FLAG KEYWORD SCRAPER (Mold, Dampness, Settling, Wood Rot)
    // ---------------------------------------------------------------------------------
    const commentaryAgg = `
      ${appraisal.neighborhoodCommentary} 
      ${appraisal.physicalConditionCommentary} 
      ${appraisal.comparablesCommentary} 
      ${appraisal.reconciliationCommentary}
    `.toLowerCase();

    const redFlagTerms = [
      { word: 'mold', code: 'REDFLAG_MOLD', desc: 'Possible toxic mold or fungal growth noted in appraiser comments.' },
      { word: 'mildew', code: 'REDFLAG_MILDEW', desc: 'Mildew or biological growth detected.' },
      { word: 'dampness', code: 'REDFLAG_DAMPNESS', desc: 'Basement, crawlspace, or structural dampness/excessive moisture noted.' },
      { word: 'settling', code: 'REDFLAG_SETTLING', desc: 'Structural foundation settling or shifting mentioned by appraiser.' },
      { word: 'crack', code: 'REDFLAG_CRACKS', desc: 'Slab or foundation wall cracking flagged in commentary.' },
      { word: 'wood rot', code: 'REDFLAG_WOOD_ROT', desc: 'Wood rot, decay, or moisture damage on structural trim/fascia.' },
      { word: 'rot', code: 'REDFLAG_ROT', desc: 'Rot or structural decay noted.' },
      { word: 'defect', code: 'REDFLAG_DEFECT', desc: 'Material structural or cosmetic defect noted.' },
      { word: 'unprofessional', code: 'REDFLAG_WORKMANSHIP', desc: 'Unprofessional or substandard workmanship noted in improvements.' },
      { word: 'deferred', code: 'REDFLAG_DEFERRED', desc: 'Deferred maintenance items flagged by appraiser.' },
      { word: 'wet', code: 'REDFLAG_MOISTURE', desc: 'Excessive water pooling, standing water, or water intrusion noted.' }
    ];

    redFlagTerms.forEach(term => {
      if (commentaryAgg.includes(term.word)) {
        const severity = (term.word === 'mold' || term.word === 'crack') ? 'CRITICAL_ERROR' : 'WARNING';
        items.push({
          id: `REDFLAG-${term.code}-${timestamp}`,
          code: term.code,
          category: 'REPAIR',
          severity: severity as any,
          description: `${term.desc} Appraiser Commentary: "${term.word}" was parsed in the appraisal report.`,
          sourceAuthority: program === 'FHA' ? 'FHA_HUD_4000_1' : 'VA_PAM_26_7_CH12',
          autoPrefillNovConditionText: `NOTICE OF VALUE REPAIR: Licensed specialist must inspect and certify clearance/repair of all noted conditions related to ${term.word}.`,
          autoPrefillCcdeConditionText: `FHA CCDE REQUIREMENT: Certified inspection and structural clearance required to address noted '${term.word}' condition prior to loan closing.`,
          isCleared: false
        });
      }
    });

    // -------------------------------------------------------------------------
    // SECTION 2: ADMINISTRATIVE & TITLE CHECKS (Case Number, Use, Leaseholds)
    // -------------------------------------------------------------------------

    // FHA/VA Case Number Check
    if ((program === 'FHA' || program === 'VA') && appraisal.caseNumber !== appraisal.expectedCaseNumber) {
      items.push({
        id: `ADMIN-CASE-MISMATCH-${timestamp}`,
        code: 'CASE_NUMBER_DISCREPANCY',
        category: 'ADMIN',
        severity: 'CRITICAL_ERROR',
        description: `Appraisal case number '${appraisal.caseNumber}' does not match the expected case number '${appraisal.expectedCaseNumber}'.`,
        sourceAuthority: program === 'FHA' ? 'FHA_HUD_4000_1' : 'VA_PAM_26_7_CH12',
        coordinates: { pageIndex: 0, box: [0.75, 0.05, 0.20, 0.03] },
        autoPrefillNovConditionText: `Appraiser must issue an administrative correction to amend Case Number to match exactly: ${appraisal.expectedCaseNumber}.`,
        autoPrefillCcdeConditionText: `CCDE CONDITIONAL COMMITMENT: File rejected for closing until Appraiser amends case number on appraisal form to match: ${appraisal.expectedCaseNumber}.`,
        isCleared: false
      });
    }

    // Intended Use Verification
    const intendedUseLower = appraisal.intendedUse.toLowerCase();
    if (!intendedUseLower.includes('underwrite') && !intendedUseLower.includes('mortgage') && !intendedUseLower.includes('lender')) {
      items.push({
        id: `ADMIN-INTENDED-USE-${timestamp}`,
        code: 'INTENDED_USE_INVALID',
        category: 'ADMIN',
        severity: 'CRITICAL_ERROR',
        description: `Appraisal 'Intended Use' commentary does not identify mortgage underwriting or mortgage lending.`,
        sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
        coordinates: { pageIndex: 0, box: [0.10, 0.22, 0.80, 0.04] },
        isCleared: false
      });
    }

    // Highest and Best Use Rule
    if (!appraisal.highestAndBestUse) {
      items.push({
        id: `ADMIN-HIGHEST-BEST-${timestamp}`,
        code: 'HIGHEST_BEST_USE_FALSE',
        category: 'ADMIN',
        severity: 'CRITICAL_ERROR',
        description: `Highest and Best Use is checked 'No'. Collateral is ineligible for GSE, FHA, or VA financing.`,
        sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
        coordinates: { pageIndex: 0, box: [0.45, 0.32, 0.05, 0.02] },
        isCleared: false
      });
    }

    // Leasehold vs Fee Simple Guidelines
    if (appraisal.ownershipType === 'LEASEHOLD') {
      const today = new Date();
      const yearsRemaining = appraisal.remainingLeaseTermYears || 0;
      const loanMaturityYear = appraisal.loanMaturityDate.getFullYear();
      const currentYear = today.getFullYear();
      const loanTermYears = loanMaturityYear - currentYear;
      const minimumLeaseTermRequired = loanTermYears + 15; // HUD requires loan term + 15 years

      if (yearsRemaining < minimumLeaseTermRequired) {
        items.push({
          id: `ADMIN-LEASE-TERM-${timestamp}`,
          code: 'LEASEHOLD_EXPIRED_TERM',
          category: 'ADMIN',
          severity: 'CRITICAL_ERROR',
          description: `Property is Leasehold. Remaining lease term (${yearsRemaining} years) is less than HUD/GSE requirement of loan term + 15 years (${minimumLeaseTermRequired} years expected).`,
          sourceAuthority: 'FHA_HUD_4000_1',
          coordinates: { pageIndex: 0, box: [0.15, 0.18, 0.30, 0.03] },
          autoPrefillNovConditionText: `Provide certified copy of recorded land lease indicating an amendment or extension of the term to at least ${minimumLeaseTermRequired} years.`,
          isCleared: false
        });
      }
    }

    // -------------------------------------------------------------------------
    // SECTION 3: FHA 90/180-DAY PROPERTY FLIPS & NON-ARM'S LENGTH CHECKS
    // -------------------------------------------------------------------------
    if (appraisal.isPurchaseTransaction) {
      if (appraisal.isNonArmsLengthTransaction) {
        items.push({
          id: `TRANSACTION-NAL-${timestamp}`,
          code: 'NON_ARMS_LENGTH_TRANSACTION',
          category: 'LEGAL_REVIEW',
          severity: 'WARNING',
          description: `Transaction flagged as Non-Arm's Length (buyer and seller have personal/business ties). This requires LTV restriction or verification of equity transfer.`,
          sourceAuthority: program === 'FHA' ? 'FHA_HUD_4000_1' : 'FANNIE_MAE_SEL_GUIDE',
          autoPrefillCcdeConditionText: `FHA CCDE REQUIREMENT: Non-Arm's length transaction detected. Underwriter must verify Maximum FHA LTV is restricted to 85.0% unless meeting standard HUD relationship exceptions.`,
          isCleared: false
        });
      }

      if (program === 'FHA' && appraisal.priorSaleDate && appraisal.currentContractDate) {
        const diffTime = Math.abs(appraisal.currentContractDate.getTime() - appraisal.priorSaleDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 90) {
          items.push({
            id: `FLIP-REJECTION-${timestamp}`,
            code: 'FHA_90_DAY_FLIP_REJECTION',
            category: 'CRITICAL_DISCREPANCY',
            severity: 'CRITICAL_ERROR',
            description: `FHA 90-Day Flip Prohibition: Subject property was acquired by the seller on ${appraisal.priorSaleDate.toLocaleDateString()} (${diffDays} days prior to current contract date). Properties resold within 90 days are ineligible for FHA insurance.`,
            sourceAuthority: 'FHA_HUD_4000_1',
            autoPrefillCcdeConditionText: `CRITICAL INELIGIBILITY: This transaction violates FHA's 90-day property resale rule. The loan is ineligible for FHA insurance.`,
            isCleared: false
          });
        }
        else if (diffDays > 90 && diffDays <= 180 && appraisal.priorSalePrice && appraisal.contractSalesPrice) {
          const priorPriceDec = new Decimal(appraisal.priorSalePrice);
          const currentPriceDec = new Decimal(appraisal.contractSalesPrice);
          const priceDelta = currentPriceDec.sub(priorPriceDec);
          const percentIncrease = priceDelta.div(priorPriceDec).mul(100).toNumber();

          if (percentIncrease >= 100.0) {
            items.push({
              id: `FLIP-DOUBLE-APPRAISAL-${timestamp}`,
              code: 'FHA_180_DAY_FLIP_DOUBLE_APPRAISAL',
              category: 'INSPECTION',
              severity: 'CRITICAL_ERROR',
              description: `FHA 181-Day Flip Rule Triggered: Property resold in ${diffDays} days with a price appreciation of ${percentIncrease.toFixed(1)}% (exceeds 100% threshold). This mandates a second independent appraisal to validate the valuation.`,
              sourceAuthority: 'FHA_HUD_4000_1',
              autoPrefillCcdeConditionText: `FHA CCDE REQUIREMENT: Property acquired by seller within 180 days at a price increase >= 100%. Underwriter must obtain and review a second independent appraisal from an active FHA roster appraiser.`,
              isCleared: false
            });
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // SECTION 4: FHA MANUFACTURED HOUSING SPECIFIC RULES
    // -------------------------------------------------------------------------
    if (appraisal.propertyType === 'MANUFACTURED' || appraisal.isManufacturedHousing) {
      if (!appraisal.hudCertificationPlatesPresent && program === 'FHA') {
        items.push({
          id: `MFG-HUD-PLATES-${timestamp}`,
          code: 'HUD_PLATES_MISSING',
          category: 'INSPECTION',
          severity: 'CRITICAL_ERROR',
          description: `Manufactured home missing physical HUD Certification Plates/Tags on the exterior.`,
          sourceAuthority: 'FHA_HUD_4000_1',
          autoPrefillCcdeConditionText: `CCDE REQUIREMENT: Provide certified HUD Label Verification Report from IBTS or obtain verification letter from the manufacturer confirming compliance with federal HUD standards.`,
          isCleared: false
        });
      }

      if (!appraisal.hudDataPlatePresent && program === 'FHA') {
        items.push({
          id: `MFG-DATA-PLATE-${timestamp}`,
          code: 'HUD_DATA_PLATE_MISSING',
          category: 'INSPECTION',
          severity: 'WARNING',
          description: `Manufactured home indoor Data Plate/Compliance Certificate is missing or unreadable.`,
          sourceAuthority: 'FHA_HUD_4000_1',
          isCleared: false
        });
      }

      if (!appraisal.hasFoundationEngineersCertificate) {
        items.push({
          id: `MFG-FOUNDATION-${timestamp}`,
          code: 'FOUNDATION_CERTIFICATE_REQUIRED',
          category: 'INSPECTION',
          severity: 'CRITICAL_ERROR',
          description: `Manufactured property foundation must have a certified structural engineer inspection in accordance with HUD Permanent Foundations Guide.`,
          sourceAuthority: 'FHA_HUD_4000_1',
          autoPrefillCcdeConditionText: `CCDE REQUIREMENT: Obtain and submit a certified foundation engineer's report bearing the seal of a licensed structural engineer confirming that the manufactured foundation complies with the HUD Permanent Foundations Guide (PFGMH-96).`,
          isCleared: false
        });
      }
    }

    // -------------------------------------------------------------------------
    // SECTION 5: PHYSICAL VISUAL INSPECTIONS & HUD/VA MPRs
    // -------------------------------------------------------------------------
    if (program === 'FHA' || program === 'VA') {
      if (appraisal.yearBuilt < 1978 && appraisal.peelingPaintDetected) {
        items.push({
          id: `PHYS-LEAD-PAINT-${timestamp}`,
          code: 'HUD_PRE_1978_LEAD_PAINT',
          category: 'REPAIR',
          severity: 'CRITICAL_ERROR',
          description: `Subject constructed in ${appraisal.yearBuilt} (pre-1978) and displays peeling/chipping paint. HUD/VA mandates lead containment scraping and sealing.`,
          sourceAuthority: program === 'FHA' ? 'FHA_HUD_4000_1' : 'VA_PAM_26_7_CH12',
          autoPrefillNovConditionText: `REPAIR CONDITION: Scrape, prime, and repaint all peeling, chipping, and scaling paint surfaces on both interior and exterior boundaries. All scrapings must be safely gathered and discarded under lead-safe practices.`,
          autoPrefillCcdeConditionText: `CCDE COMPLIANCE CONDITION: Pre-1978 property peeling paint identified. Prior to closing, submit satisfactory appraiser certification or HUD inspector report confirming all peeling paint has been scraped, sealed, and treated.`,
          isCleared: false
        });
      }

      if (program === 'FHA' && (!appraisal.atticInspected || !appraisal.crawlspaceInspected)) {
        items.push({
          id: `PHYS-ATTIC-CRAWL-${timestamp}`,
          code: 'HUD_ATTIC_CRAWL_NOT_VIEWED',
          category: 'INSPECTION',
          severity: 'CRITICAL_ERROR',
          description: `FHA requires appraiser to conduct a complete physical 'head & shoulders' visual inspection of both the attic and crawlspace sections.`,
          sourceAuthority: 'FHA_HUD_4000_1',
          coordinates: { pageIndex: 1, box: [0.25, 0.60, 0.35, 0.04] },
          autoPrefillNovConditionText: `Appraiser must re-access property to perform and document a head-and-shoulders inspection of the attic/crawlspace cavities, providing update pictures and revised commentary verifying structural soundness.`,
          isCleared: false
        });
      }

      if (program === 'FHA' && !appraisal.septicWellVisualInspectionNoted) {
        items.push({
          id: `PHYS-WELL-SEPTIC-${timestamp}`,
          code: 'HUD_WELL_SEPTIC_VISUAL_MISSING',
          category: 'INSPECTION',
          severity: 'WARNING',
          description: `Private well/septic system noted but lack of appraiser visual operational and distance clearance verbiage.`,
          sourceAuthority: 'FHA_HUD_4000_1',
          isCleared: false
        });
      }

      if (!appraisal.utilitiesAreActive) {
        items.push({
          id: `PHYS-UTILS-OFF-${timestamp}`,
          code: 'HUD_UTILITIES_INACTIVE',
          category: 'REPAIR',
          severity: 'CRITICAL_ERROR',
          description: `Inactive utility systems (water, electric, or gas off) noted. FHA and VA require fully functioning utilities at inspection.`,
          sourceAuthority: program === 'FHA' ? 'FHA_HUD_4000_1' : 'VA_PAM_26_7_CH12',
          autoPrefillNovConditionText: `REPAIR CONDITION: Fully restore and activate all property utility lines (water, electricity, and gas) to enable the appraiser or a third-party certifier to confirm proper operational condition of all mechanical heating, plumbing, and electrical subsystems.`,
          isCleared: false
        });
      }
    }

    if (program === 'VA') {
      if (appraisal.termiteActiveInfestationDetected) {
        items.push({
          id: `PHYS-VA-TERMITE-${timestamp}`,
          code: 'VA_TERMITE_ACTIVE_HAZARD',
          category: 'REPAIR',
          severity: 'CRITICAL_ERROR',
          description: `Appraisal notes active wood-destroying insect (termite) infestation or structural damage.`,
          sourceAuthority: 'VA_PAM_26_7_CH12',
          autoPrefillNovConditionText: `NOTICE OF VALUE CONDITION: Provide a certified termite treatment certificate and a clean Wood-Destroying Insect (WDI) report from a licensed pest control company confirming that the property has been treated and is free of active wood-destroying insect activity.`,
          isCleared: false
        });
      }

      if (appraisal.wellWaterPotabilityTestCleared === false) {
        items.push({
          id: `PHYS-VA-WATER-${timestamp}`,
          code: 'VA_WELL_WATER_POTABILITY_REQUIRED',
          category: 'INSPECTION',
          severity: 'CRITICAL_ERROR',
          description: `Private well water potability test is missing or has failed required chemical thresholds.`,
          sourceAuthority: 'VA_PAM_26_7_CH12',
          autoPrefillNovConditionText: `NOTICE OF VALUE CONDITION: Obtain and submit a certified chemical and bacteriological water test report from a local state health laboratory verifying that the private well supply meets local health authority limits.`,
          isCleared: false
        });
      }
    }

    // -------------------------------------------------------------------------
    // SECTION 6: SOLAR & ENERGY SYSTEMS COMPLIANCE AGENT
    // -------------------------------------------------------------------------
    if (appraisal.hasSolarPanels) {
      const solarType = appraisal.solarOwnershipType || (appraisal.solarSystemIsLeased ? 'LEASED' : 'OWNED');

      if ((solarType === 'LEASED' || solarType === 'PPA') && !appraisal.solarLeasePaymentsIncludedInDti && !appraisal.solarLeasePaymentImpactsDti) {
        items.push({
          id: `SOLAR-DTI-CHECK-${timestamp}`,
          code: 'SOLAR_LEASE_DTI_EXCLUSION',
          category: 'ADMIN',
          severity: 'WARNING',
          description: `Property contains a ${solarType} solar system. The monthly lease/PPA payment is not documented as included in the Debt-to-Income (DTI) calculation.`,
          sourceAuthority: program === 'FHA' ? 'FHA_HUD_4000_1' : 'VA_PAM_26_7_CH12',
          autoPrefillNovConditionText: `Provide the executed solar panel lease or Power Purchase Agreement (PPA). Underwriter must verify the monthly payment terms and confirm that the payment is counted within the borrower's debt-to-income (DTI) ratio.`,
          isCleared: false
        });
      }

      if ((solarType === 'LEASED' || solarType === 'PPA') && (appraisal.solarAgreementContainsTransferRestrictions || appraisal.solarLeaseTransferRestrictionsPresent)) {
        items.push({
          id: `SOLAR-TRANSFER-RESTR-${timestamp}`,
          code: 'SOLAR_LEASE_TRANSFER_RESTRICTED',
          category: 'ADMIN',
          severity: 'WARNING',
          description: `Solar panel ${solarType} agreement has transfer restrictions that could bind subsequent property buyers.`,
          sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
          autoPrefillNovConditionText: `Submit full solar panel agreement for legal/underwriting review. Confirm that the solar provider allows fully transferable rights to subsequent mortgage purchasers without fee penalties.`,
          isCleared: false
        });
      }

      if ((solarType === 'LEASED' || solarType === 'PPA') && (appraisal.solarAppraisalValueAdjustmentIncluded || appraisal.solarSystemContributoryValueAdjustment > 0)) {
        const valAdj = appraisal.solarSystemContributoryValueAdjustment || 0;
        items.push({
          id: `SOLAR-VALUE-VIOLATION-${timestamp}`,
          code: 'SOLAR_LEASE_VALUATION_VIOLATION',
          category: 'CRITICAL_DISCREPANCY',
          severity: 'CRITICAL_ERROR',
          description: `CRITICAL HUD/GSE EXCEPTION: The appraiser included physical valuation adjustments of $${valAdj} for a ${solarType} solar system. Leased solar panels are personal property and cannot contribute to the real property appraisal valuation.`,
          sourceAuthority: program === 'FHA' ? 'FHA_HUD_4000_1' : 'FANNIE_MAE_SEL_GUIDE',
          coordinates: { pageIndex: 1, box: [0.12, 0.45, 0.25, 0.05] }, // Page 2 of URAR
          autoPrefillNovConditionText: `The appraiser must revise the appraisal report to remove any contributory valuation adjustments given to the leased/PPA solar energy system. Leased energy equipment is personal property and cannot be factored into the property's appraised value.`,
          autoPrefillCcdeConditionText: `CCDE CONDITIONAL AMENDMENT: Appraiser must revise the URAR comparison grid to remove the contributory valuation adjustment of $${valAdj} given to the leased solar panels.`,
          isCleared: false
        });
      }

      if (program === 'VA' && solarType === 'OWNED') {
        items.push({
          id: `SOLAR-VA-MPR-${timestamp}`,
          code: 'VA_SOLAR_OWNED_MPR_INFO',
          category: 'ADMIN',
          severity: 'COMPLIANCE_INFO',
          description: `Subject solar energy system is owned. Underwriter to confirm system is fully operational and has been certified to meet local electrical codes.`,
          sourceAuthority: 'VA_PAM_26_7_CH12',
          isCleared: false
        });
      }
    }

    // -------------------------------------------------------------------------
    // SECTION 7: DETAILED MATRIX COMPARABLE GRID AUDITING
    // -------------------------------------------------------------------------
    appraisal.comparables.forEach((comp) => {
      const idx = comp.compIndex;
      const priceDec = new Decimal(comp.salePrice);
      const netDec = new Decimal(comp.netAdjustmentAmount);
      const grossDec = new Decimal(comp.grossAdjustmentAmount);

      const netAdjustmentRatio = priceDec.gt(0) ? netDec.abs().div(priceDec).mul(100).toNumber() : 0;
      const grossAdjustmentRatio = priceDec.gt(0) ? grossDec.div(priceDec).mul(100).toNumber() : 0;

      // Dynamic cell-coordinate helper for precise matrix highlights
      const getCoords = (field: string): SpatialCoordinates | undefined => {
        if (comp.cellCoordinates && comp.cellCoordinates[field]) {
          const cell = comp.cellCoordinates[field];
          return { pageIndex: cell.pageIndex, box: cell.box };
        }
        // Fallback to standard URAR grid locations (Comp 1-3 page 1 / 2)
        const xOffset = 0.30 + (idx - 1) * 0.20; // column index offsets
        if (field === 'salePrice') return { pageIndex: 1, box: [xOffset, 0.40, 0.18, 0.02] };
        if (field === 'proximity') return { pageIndex: 1, box: [xOffset, 0.43, 0.18, 0.02] };
        if (field === 'net_adjustments') return { pageIndex: 1, box: [xOffset, 0.82, 0.18, 0.02] };
        if (field === 'gross_adjustments') return { pageIndex: 1, box: [xOffset, 0.85, 0.18, 0.02] };
        return undefined;
      };

      // Rule: Distance threshold (Urban standard <= 1.0 mile, rural/suburban handled contextually)
      if (comp.proximityMiles > 1.0) {
        items.push({
          id: `GRID-DISTANCE-COMP-${idx}-${timestamp}`,
          code: `GSE_COMP_DISTANCE_WARN_COMP${idx}`,
          category: 'ADMIN',
          severity: 'WARNING',
          description: `Comparable #${idx} is located ${comp.proximityMiles} miles from the subject (standard guideline: <= 1.0 mile). Appraiser must supply market/location reconciliation.`,
          sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
          coordinates: getCoords('proximity'),
          isCleared: false
        });
      }

      // Rule: Net Adjustments > 15% (Standard Fannie Mae warning threshold)
      if (netAdjustmentRatio > 15.0) {
        items.push({
          id: `GRID-NET-WARN-COMP-${idx}-${timestamp}`,
          code: `GSE_NET_ADJUSTMENT_EXCEEDED_COMP${idx}`,
          category: 'ADMIN',
          severity: 'WARNING',
          description: `Comparable #${idx} Net Adjustments (${netAdjustmentRatio.toFixed(1)}%) exceed standard 15% guideline. Check for excessive appraisal adjustments.`,
          sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
          coordinates: getCoords('net_adjustments'),
          isCleared: false
        });
      }

      // Rule: Gross Adjustments > 25% (Standard Fannie Mae warning threshold)
      if (grossAdjustmentRatio > 25.0) {
        items.push({
          id: `GRID-GROSS-WARN-COMP-${idx}-${timestamp}`,
          code: `GSE_GROSS_ADJUSTMENT_EXCEEDED_COMP${idx}`,
          category: 'ADMIN',
          severity: 'WARNING',
          description: `Comparable #${idx} Gross Adjustments (${grossAdjustmentRatio.toFixed(1)}%) exceed standard 25% guideline. Appraiser must justify market representativeness.`,
          sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
          coordinates: getCoords('gross_adjustments'),
          isCleared: false
        });
      }

      // Rule: Individual line-item adjustment > 10% of sale price
      comp.individualLineItemAdjustments.forEach((adj) => {
        const adjDec = new Decimal(adj.amount);
        const lineItemRatio = priceDec.gt(0) ? adjDec.abs().div(priceDec).mul(100).toNumber() : 0;
        
        if (lineItemRatio > 10.0) {
          items.push({
            id: `GRID-LINE-WARN-COMP-${idx}-${adj.field.replace(/\s+/g, '-')}-${timestamp}`,
            code: `GSE_LINE_ITEM_ADJUSTMENT_EXCEEDED_COMP${idx}`,
            category: 'ADMIN',
            severity: 'WARNING',
            description: `Comparable #${idx} line-item adjustment for '${adj.field}' ($${adj.amount}) represents ${lineItemRatio.toFixed(1)}% of sale price (exceeds 10% baseline).`,
            sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
            coordinates: getCoords(adj.field) || adj.coordinates,
            isCleared: false
          });
        }
      });
    });

    // -------------------------------------------------------------------------
    // SECTION 8: Form 1004MC MARKET CONDITIONS CROSS-VALIDATION
    // -------------------------------------------------------------------------
    const mcPriceDropRatio = appraisal.mcMedianPricePriorYearQuarter > 0 
      ? ((appraisal.mcMedianPriceCurrentQuarter - appraisal.mcMedianPricePriorYearQuarter) / appraisal.mcMedianPricePriorYearQuarter) * 100
      : 0;

    // Discrepancy Rule 1: Declining MC vs Page 1 "Stable" or "Increasing"
    if (mcPriceDropRatio < -3.0 && appraisal.neighborhoodTrend !== 'DECLINING') {
      items.push({
        id: `MC-DISCREPANCY-TREND-${timestamp}`,
        code: 'MC_TREND_DECLINE_DISCREPANCY',
        category: 'CRITICAL_DISCREPANCY',
        severity: 'CRITICAL_ERROR',
        description: `URAR Page 1 neighborhood trend is marked '${appraisal.neighborhoodTrend}', but Form 1004MC reflects a mathematical decline of ${mcPriceDropRatio.toFixed(1)}% in median sales prices over the past year.`,
        sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
        coordinates: { pageIndex: 2, box: [0.65, 0.40, 0.15, 0.05] }, // Focuses on 1004MC trends section
        autoPrefillNovConditionText: `Appraiser must clarify the discrepancy between the 'Stable/Increasing' neighborhood trend selected on Page 1 vs the ${mcPriceDropRatio.toFixed(1)}% drop computed within the 1004MC Market Addendum.`,
        isCleared: false
      });
    }

    // Discrepancy Rule 2: Months Supply over 6 months indicating declining absorption
    if (appraisal.mcMonthsSupplyCurrentQuarter > 6.0 && appraisal.neighborhoodTrend === 'INCREASING') {
      items.push({
        id: `MC-DISCREPANCY-SUPPLY-${timestamp}`,
        code: 'MC_SUPPLY_OVERSUPPLY_DISCREPANCY',
        category: 'CRITICAL_DISCREPANCY',
        severity: 'WARNING',
        description: `1004MC indicates ${appraisal.mcMonthsSupplyCurrentQuarter} months of supply (Oversupply market), but neighborhood trend is marked 'Increasing'.`,
        sourceAuthority: 'FANNIE_MAE_SEL_GUIDE',
        isCleared: false
      });
    }

    return items;
  }
}
