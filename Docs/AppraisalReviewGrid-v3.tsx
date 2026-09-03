'use client';

import React, { useState, useMemo } from 'react';
import { 
  Building, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  MapPin, 
  DollarSign, 
  ArrowRight, 
  CheckSquare, 
  Square,
  ClipboardList,
  Home,
  Info,
  Layers,
  Wrench,
  UserCheck,
  FilePlus2,
  Trash2,
  TrendingDown,
  Percent,
  FileText,
  Hammer,
  FileSpreadsheet,
  RefreshCw,
  Settings2,
  Eye,
  Activity,
  AlertCircle,
  Calendar,
  AlertOctagon,
  Search,
  Sparkles
} from 'lucide-react';

// Definitions for Appraisal review structures
interface CompProperty {
  propertyType: string;
  address: string;
  gla: number;
  salePrice: number;
  proximityMiles: number;
  netAdjustment: number;
  grossAdjustment: number;
  lineItemAdjustments: { field: string; amount: number }[];
}

interface NovCondition {
  id: string;
  category: 'REPAIR' | 'INSPECTION' | 'ADMIN';
  text: string;
  sourceAuthority: 'FHA_HUD_4000' | 'VA_PAM_26_7' | 'GSE_GUIDELINE';
  isCleared: boolean;
  prefilledFrom?: string; // Tracks which rule triggered the prefill
}

export const AppraisalReviewGrid: React.FC = () => {
  // 1. Core State Hooks
  const [formType, setFormType] = useState<'FORM_1004' | 'FORM_1073' | 'FORM_1025'>('FORM_1004');
  const [programType, setProgramType] = useState<'CONV' | 'FHA' | 'VA'>('FHA');
  const [activeTab, setActiveTab] = useState<'GRID' | '1004MC' | 'CHECKLIST' | 'CONTRACT_AUDIT' | 'COMMENTARY'>('GRID');
  const [highlightColumn, setHighlightColumn] = useState<string | null>(null);
  
  // Administrative Verification States
  const [caseNumber, setCaseNumber] = useState<string>('FHA-451-904322-B');
  const [propertyOwnership, setPropertyOwnership] = useState<'FEE_SIMPLE' | 'LEASEHOLD'>('FEE_SIMPLE');
  const [leaseTermRemainingYears, setLeaseTermRemainingYears] = useState<number>(35);
  const [caseNumberMatches1003, setCaseNumberMatches1003] = useState<boolean>(true);
  const [highestBestUseYes, setHighestBestUseYes] = useState<boolean>(true);
  const [intendedUseComplies, setIntendedUseComplies] = useState<boolean>(true);

  // Property Type & Manufactured Housing Specifics
  const [isManufacturedHome, setIsManufacturedHome] = useState<boolean>(false);
  const [hudCertificationTagPresent, setHudCertificationTagPresent] = useState<boolean>(false); // Exterior red metal tag
  const [hudDataPlatePresent, setHudDataPlatePresent] = useState<boolean>(false); // Interior paper data plate
  const [foundationEngineerReportAttached, setFoundationEngineerReportAttached] = useState<boolean>(false);

  // FHA CCDE Form HUD-92800.5B states
  const [hud928005bCompleted, setHud928005bCompleted] = useState<boolean>(false);
  const [hud928005bValuationMatches, setHud928005bValuationMatches] = useState<boolean>(true);
  const [hud928005bExpirationValid, setHud928005bExpirationValid] = useState<boolean>(true);

  // Purchase Contract Audit States
  const [isPurchaseLoan, setIsPurchaseLoan] = useState<boolean>(true);
  const [contractDateStr, setContractDateStr] = useState<string>('2026-08-01');
  const [priorSaleDateStr, setPriorSaleDateStr] = useState<string>('2026-07-15'); // Flags FHA 90-day flip!
  const [priorSalePrice, setPriorSalePrice] = useState<number>(200000);
  const [contractSellerIsOwnerRecord, setContractSellerIsOwnerRecord] = useState<boolean>(false); // Warns if false
  const [nonArmsLengthTransaction, setNonArmsLengthTransaction] = useState<boolean>(true); // Alerts if true

  // FHA 4000.1 & VA MPR Physical Condition States
  const [atticInspected, setAtticInspected] = useState<boolean>(false);
  const [crawlspaceInspected, setCrawlspaceInspected] = useState<boolean>(false);
  const [peelingPaintDetected, setPeelingPaintDetected] = useState<boolean>(true); // Home built pre-1978
  const [septicWellVisualInspection, setSepticWellVisualInspection] = useState<boolean>(false);
  const [utilitiesFunctional, setUtilitiesFunctional] = useState<boolean>(false);

  // Solar & Energy Systems States
  const [hasSolarPanels, setHasSolarPanels] = useState<boolean>(true);
  const [solarOwnership, setSolarOwnership] = useState<'LEASED' | 'OWNED'>('LEASED');
  const [solarValueAdjustmentIncluded, setSolarAppraisalValueAdjustmentIncluded] = useState<boolean>(true); // LEASED solar can't have adjustment!
  const [solarLeaseIncludedInDti, setSolarLeasePaymentsIncludedInDti] = useState<boolean>(false);
  const [solarAgreementContainsRestrictions, setSolarAgreementContainsTransferRestrictions] = useState<boolean>(true);
  
  // VA MPR Specific Checks
  const [termiteReportAttached, setTermiteReportAttached] = useState<boolean>(false);
  const [wellWaterTested, setWellWaterTested] = useState<boolean>(false);
  const [heatingMaintainsFiftyDegrees, setHeatingMaintainsFiftyDegrees] = useState<boolean>(true);

  // 1004MC Market Statistics Mock States
  const [mcMedianPricePrior7_12, setMcMedianPricePrior7_12] = useState<number>(350000);
  const [mcMedianPricePrior4_6, setMcMedianPricePrior4_6] = useState<number>(342000);
  const [mcMedianPriceCurrent3, setMcMedianPriceCurrent3] = useState<number>(330000);
  const [mcMonthsSupplyCurrent3, setMcMonthsSupplyCurrent3] = useState<number>(6.5);
  const [urarNeighborhoodTrend, setUrarNeighborhoodTrend] = useState<'INCREASING' | 'STABLE' | 'DECLINING'>('STABLE');

  // Commentary Text Blocks for Red Flag Keywords Scanning
  const [commentaryTextBlocks, setCommentaryTextBlocks] = useState<string[]>([
    "The subject property exhibits typical wear and tear for its age. However, some areas in the crawl space show signs of moisture accumulation and mild dampness due to recent rain.",
    "A visual inspection of the attic was performed from the access hatch. There were no visible framing cracks or structural integrity failures noted at this time, though minor ceiling settling was observed in the secondary bedroom.",
    "Potential mold spores were observed along the lower baseboards of the detached utility closet. Appraiser recommends a professional trade inspection to determine if hazardous remediation is required.",
    "Exterior inspection noted minor hairline cracking on the concrete driveway. There were no signs of structural settling or soil displacement affecting the main residential foundation."
  ]);

  const [newCommentaryBlock, setNewCommentaryBlock] = useState<string>('');

  // Metadata mock state
  const metadata = {
    loanId: 'LN-2026-9043',
    borrowerName: 'Sarah K. Vance',
    appraisedValue: 425000,
    effectiveDate: '08/24/2026',
    appraiserName: 'Robert J. Miller',
    appraiserLicense: 'A-1084-TX',
    yearBuilt: 1974, // Pre-1978 triggers lead paint warnings
  };

  // Comparables Grid Mock Data
  const compsData = useMemo<CompProperty[]>(() => [
    {
      propertyType: 'Subject',
      address: '742 Whispering Pines Dr, Austin TX 78745',
      gla: 1850,
      salePrice: 0,
      proximityMiles: 0,
      netAdjustment: 0,
      grossAdjustment: 0,
      lineItemAdjustments: []
    },
    {
      propertyType: 'Comparable 1',
      address: '142 Maplewood Ave, Austin TX 78745',
      gla: 1900,
      salePrice: 425000,
      proximityMiles: 0.45,
      netAdjustment: 15000,
      grossAdjustment: 25000,
      lineItemAdjustments: [\n        { field: 'GLA Difference', amount: 5000 },\n        { field: 'Bathroom Count', amount: 10000 },\n        { field: 'Garage/Carport', amount: 10000 }\n      ]\n    },
    {
      propertyType: 'Comparable 2',
      address: '98 Oak Ridge Rd, West Lake Hills TX 78746',
      gla: 1780,
      salePrice: 410000,
      proximityMiles: 1.2, // Exceeds 1-mile urban/suburban baseline
      netAdjustment: -8000,
      grossAdjustment: 48000, // Gross adjustment ratio = 11.7%
      lineItemAdjustments: [\n        { field: 'Location Adjustment', amount: -18000 },\n        { field: 'GLA Difference', amount: -30000 } // Individual line item > 10% sale price (reaches 7.3%)\n      ]\n    },
    {
      propertyType: 'Comparable 3',
      address: '33 Clover Lane, Austin TX 78745',
      gla: 1840,
      salePrice: 435000,
      proximityMiles: 0.8,
      netAdjustment: 2000,
      grossAdjustment: 12000,
      lineItemAdjustments: [\n        { field: 'Age / Condition', amount: 2000 },\n        { field: 'Decks/Porches', amount: 10000 }\n      ]\n    }
  ], []);

  const [manualConditions, setManualConditions] = useState<NovCondition[]>([]);
  const [newConditionText, setNewConditionText] = useState<string>('');
  const [newConditionCategory, setNewConditionCategory] = useState<'REPAIR' | 'INSPECTION' | 'ADMIN'>('REPAIR');

  // Compute property flip statistics
  const purchaseAuditResults = useMemo(() => {
    if (!isPurchaseLoan) return { isFlip: false, days: 0, priceIncreasePercent: 0, requireDoubleAppraisal: false };
    try {
      const contractD = new Date(contractDateStr);
      const priorD = new Date(priorSaleDateStr);
      const diffTime = Math.abs(contractD.getTime() - priorD.getTime());
      const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      const resPrice = compsData[1]?.salePrice || 425000; // Comparable proxy or appraised value
      const priceDelta = resPrice - priorSalePrice;
      const priceIncreasePercent = priorSalePrice > 0 ? (priceDelta / priorSalePrice) * 100 : 0;
      
      const isFlip = days <= 180;
      const requireDoubleAppraisal = programType === 'FHA' && days > 90 && days <= 180 && priceIncreasePercent > 100;

      return { isFlip, days, priceIncreasePercent, requireDoubleAppraisal };
    } catch {
      return { isFlip: false, days: 0, priceIncreasePercent: 0, requireDoubleAppraisal: false };
    }
  }, [isPurchaseLoan, contractDateStr, priorSaleDateStr, priorSalePrice, compsData, programType]);

  // Compute Keyword Matches
  const detectedKeywords = useMemo(() => {
    const matched: { word: string; text: string; severity: 'ERROR' | 'WARNING'; code: string; blockIndex: number }[] = [];
    const triggerWords = [
      { word: 'mold', severity: 'ERROR', code: 'COMMENTARY_MOLD_ALERT' },
      { word: 'structural integrity', severity: 'ERROR', code: 'COMMENTARY_STRUCTURAL_ALERT' },
      { word: 'dampness', severity: 'WARNING', code: 'COMMENTARY_DAMPNESS_WARN' },
      { word: 'settling', severity: 'WARNING', code: 'COMMENTARY_SETTLING_WARN' },
      { word: 'crack', severity: 'WARNING', code: 'COMMENTARY_CRACKS_FOUND' },
      { word: 'leak', severity: 'WARNING', code: 'COMMENTARY_LEAK_WARN' },
      { word: 'infestation', severity: 'ERROR', code: 'COMMENTARY_PEST_ALERT' },
      { word: 'decay', severity: 'WARNING', code: 'COMMENTARY_DECAY_WARN' },
      { word: 'asbestos', severity: 'ERROR', code: 'COMMENTARY_ASBESTOS_ALERT' },
      { word: 'hazardous', severity: 'ERROR', code: 'COMMENTARY_HAZARD_ALERT' }
    ];

    commentaryTextBlocks.forEach((block, idx) => {
      triggerWords.forEach((trigger) => {
        const regex = new RegExp(`\\b${trigger.word}s?\\b`, 'i');
        if (regex.test(block)) {
          matched.push({
            word: trigger.word,
            text: block,
            severity: trigger.severity as any,
            code: trigger.code,
            blockIndex: idx
          });
        }
      });
    });

    return matched;
  }, [commentaryTextBlocks]);

  // 2. Computed Automated Conditions (Prefilled dynamic conditions based on rules)
  const automatedConditions = useMemo<NovCondition[]>(() => {
    const list: NovCondition[] = [];

    // FHA Pre-1978 Lead Paint rule
    if (metadata.yearBuilt < 1978 && peelingPaintDetected && (programType === 'FHA' || programType === 'VA')) {
      list.push({
        id: 'AUTO-LEAD',
        category: 'REPAIR',
        text: `HUD-4000.1 Requirement: Property constructed in ${metadata.yearBuilt} (pre-1978). Scrape, prime, and repaint all peeling and chipping exterior trim surfaces. Remove and discard scrapings in a safe manner before reinspection.`,
        sourceAuthority: programType === 'FHA' ? 'FHA_HUD_4000' : 'VA_PAM_26_7',
        isCleared: false,
        prefilledFrom: 'HUD_PRE_1978_LEAD'
      });
    }

    // FHA/VA Attic/Crawlspace Head and Shoulders rule
    if ((programType === 'FHA' || programType === 'VA') && (!atticInspected || !crawlspaceInspected)) {
      list.push({
        id: 'AUTO-INSPECT',
        category: 'INSPECTION',
        text: `HUD / VA MPR Mandate: Appraiser must confirm a physical 'head and shoulders' inspection of both the Attic and Crawlspace cavities. Provide a certifying addendum or a re-inspection confirmation.`,
        sourceAuthority: programType === 'FHA' ? 'FHA_HUD_4000' : 'VA_PAM_26_7',
        isCleared: false,
        prefilledFrom: 'HUD_PHYS_INSPECT'
      });
    }

    // FHA Active Utilities rule
    if (programType === 'FHA' && !utilitiesFunctional) {
      list.push({
        id: 'AUTO-UTILS',
        category: 'REPAIR',
        text: 'HUD-4000.1 active utilities: All core structural utilities (water, electricity, and gas) must be turned on and fully functional at the time of the appraisal re-inspection.',
        sourceAuthority: 'FHA_HUD_4000',
        isCleared: false,
        prefilledFrom: 'FHA_UTILS_OFF'
      });
    }

    // FHA CCDE Form HUD-92800.5B Completed Check
    if (programType === 'FHA' && !hud928005bCompleted) {
      list.push({
        id: 'AUTO-FHA-CCDE',
        category: 'ADMIN',
        text: 'FHA Direct Endorsement Requirement: Form HUD-92800.5B Conditional Commitment must be fully completed and signed by the Direct Endorsement Underwriter.',
        sourceAuthority: 'FHA_HUD_4000',
        isCleared: false,
        prefilledFrom: 'HUD_928005B_COMPLETION_REQUIRED'
      });
    }

    // FHA CCDE Valuation Discrepancy
    if (programType === 'FHA' && !hud928005bValuationMatches) {
      list.push({
        id: 'AUTO-CCDE-VAL',
        category: 'ADMIN',
        text: 'FHA CCDE Discrepancy: The underwriter must ensure the appraised value entered on Form HUD-92800.5B matches the final reconciled appraised value on the appraisal report.',
        sourceAuthority: 'FHA_HUD_4000',
        isCleared: false,
        prefilledFrom: 'HUD_928005B_VALUATION_MISMATCH'
      });
    }

    // FHA Flip 90 Day Rule
    if (programType === 'FHA' && isPurchaseLoan && purchaseAuditResults.days <= 90) {
      list.push({
        id: 'AUTO-FHA-FLIP-90',
        category: 'ADMIN',
        text: `FHA 90-Day Flip Prohibition: The seller acquired the property within 90 days of the sales contract. This property is strictly ineligible for FHA financing.`,
        sourceAuthority: 'FHA_HUD_4000',
        isCleared: false,
        prefilledFrom: 'FHA_90_DAY_FLIP_PROHIBITED'
      });
    }

    // FHA Flip 180 Day Double Appraisal Requirement
    if (programType === 'FHA' && isPurchaseLoan && purchaseAuditResults.requireDoubleAppraisal) {
      list.push({
        id: 'AUTO-FHA-FLIP-180',
        category: 'INSPECTION',
        text: `FHA Flip Rule Trigger: Property resale price exceeds prior purchase price by ${purchaseAuditResults.priceIncreasePercent.toFixed(1)}% within 180 days. A second independent appraisal is required.`,
        sourceAuthority: 'FHA_HUD_4000',
        isCleared: false,
        prefilledFrom: 'FHA_180_DAY_FLIP_DOUBLE_APPRAISAL'
      });
    }

    // Non-Arms Length check
    if (isPurchaseLoan && nonArmsLengthTransaction) {
      list.push({
        id: 'AUTO-NON-ARMS',
        category: 'ADMIN',
        text: `Non-Arm's Length Sale Clause: Underwriter must verify full terms. Under FHA rules, maximum LTV is restricted to 85% maximum mortgage limits unless owner-occupant exceptions are satisfied.`,
        sourceAuthority: programType === 'FHA' ? 'FHA_HUD_4000' : 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'CONTRACT_NON_ARMS_LENGTH'
      });
    }

    // Seller of Record check
    if (isPurchaseLoan && !contractSellerIsOwnerRecord) {
      list.push({
        id: 'AUTO-SELLER-RECORD',
        category: 'ADMIN',
        text: 'Administrative Exception: Seller of record on sales contract is not identified as current owner/deed holder. Provide chain of title.',
        sourceAuthority: 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'CONTRACT_SELLER_NOT_OWNER'
      });
    }

    // Leased Solar panels value adjustment rule (HUD 4000.1 & Fannie Mae)
    if (hasSolarPanels && solarOwnership === 'LEASED' && solarValueAdjustmentIncluded) {
      list.push({
        id: 'AUTO-SOLAR-VALUATION',
        category: 'ADMIN',
        text: `Leased Solar Panels: Valuation adjustment violates HUD 4000.1 / GSE Guidelines. Leased energy equipment is personal property and appraiser must remove all contributory value.`,
        sourceAuthority: programType === 'FHA' ? 'FHA_HUD_4000' : 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'SOLAR_LEASE_VALUATION_VIOLATION'
      });
    }

    // Leased Solar panel DTI inclusion
    if (hasSolarPanels && solarOwnership === 'LEASED' && !solarLeaseIncludedInDti) {
      list.push({
        id: 'AUTO-SOLAR-DTI',
        category: 'ADMIN',
        text: `Solar Lease DTI Requirement: Monthly lease or PPA payments must be included as a recurring monthly liability in the borrower's qualifying ratios.`,
        sourceAuthority: programType === 'FHA' ? 'FHA_HUD_4000' : 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'SOLAR_LEASE_DTI_EXCLUSION'
      });
    }

    // Solar lease agreement transfer restriction
    if (hasSolarPanels && solarOwnership === 'LEASED' && solarAgreementContainsRestrictions) {
      list.push({
        id: 'AUTO-SOLAR-TRANSFER',
        category: 'ADMIN',
        text: `Solar Lease Agreement Transfer Check: Solar provider must allow transfer to subsequent homebuyer without prepay penalties or title restrictions.`,
        sourceAuthority: 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'SOLAR_LEASE_TRANSFER_RESTRICTED'
      });
    }

    // Well & Septic check
    if ((programType === 'FHA' || programType === 'VA') && !septicWellVisualInspection) {
      list.push({
        id: 'AUTO-SEPTIC',
        category: 'INSPECTION',
        text: 'Visual Well & Septic Survey: Underwriter requires a visual survey indicating acceptable operating distances from property lines, surrounding fields, and septic tanks.',
        sourceAuthority: programType === 'FHA' ? 'FHA_HUD_4000' : 'VA_PAM_26_7',
        isCleared: false,
        prefilledFrom: 'HUD_SEPTIC_CHECK'
      });
    }

    // VA Wood Destroying Insect (Termite) check
    if (programType === 'VA' && !termiteReportAttached) {
      list.push({
        id: 'AUTO-TERMITE',
        category: 'INSPECTION',
        text: 'VA M26-7 Chapter 12: Wood-Destroying Insect (WDI) inspection clearance is required. Provide a certified termite inspection certificate indicating no active infestation.',
        sourceAuthority: 'VA_PAM_26_7',
        isCleared: false,
        prefilledFrom: 'VA_TERM_INSPECT'
      });
    }

    // VA Well Water Potability
    if (programType === 'VA' && !wellWaterTested) {
      list.push({
        id: 'AUTO-WELL',
        category: 'INSPECTION',
        text: 'VA Well Potability: Private well water test required. Provide an independent chemical and bacteriological water potability report reflecting clean health limits.',
        sourceAuthority: 'VA_PAM_26_7',
        isCleared: false,
        prefilledFrom: 'VA_WELL_WATER'
      });
    }

    // VA Heating requirement
    if (programType === 'VA' && !heatingMaintainsFiftyDegrees) {
      list.push({
        id: 'AUTO-HEAT',
        category: 'REPAIR',
        text: 'VA MPR Heating Check: The heating system must be certified as capable of maintaining 50 degrees Fahrenheit in all inhabited living spaces of the property.',
        sourceAuthority: 'VA_PAM_26_7',
        isCleared: false,
        prefilledFrom: 'VA_HEATING_MPR'
      });
    }

    // Manufactured Housing HUD labels
    if (isManufacturedHome) {
      if (!hudCertificationTagPresent || !hudDataPlatePresent) {
        list.push({
          id: 'AUTO-HUD-PLATES',
          category: 'INSPECTION',
          text: 'FHA Manufactured Housing Rule: Provide verification of the exterior HUD Certification Label (red metal tag) and interior paper HUD Data Plate. If missing, obtain an IBTS label verification letter.',
          sourceAuthority: 'FHA_HUD_4000',
          isCleared: false,
          prefilledFrom: 'HUD_MANUFACTURED_LABEL'
        });
      }
      if (!foundationEngineerReportAttached) {
        list.push({
          id: 'AUTO-FOUNDATION',
          category: 'INSPECTION',
          text: 'Manufactured Housing Foundation Rule: Provide a certified structural foundation engineer’s report confirming compliance with HUD Permanent Foundations Guide (PFGMH-96).',
          sourceAuthority: 'FHA_HUD_4000',
          isCleared: false,
          prefilledFrom: 'HUD_FOUNDATION_REPORT'
        });
      }
    }

    // Leasehold term check
    if (propertyOwnership === 'LEASEHOLD' && leaseTermRemainingYears < 15) {
      list.push({
        id: 'AUTO-LEASEHOLD',
        category: 'ADMIN',
        text: `Leasehold Remaining Term Warning: Remaining leasehold term (${leaseTermRemainingYears} years) is below the maturity window. Remaining leasehold term must exceed loan maturity by at least 15 years.`,
        sourceAuthority: 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'GSE_LEASEHOLD_WINDOW'
      });
    }

    // Administrative Validation Warnings
    if (!caseNumberMatches1003) {
      list.push({
        id: 'AUTO-CASE-MATCH',
        category: 'ADMIN',
        text: `FHA/VA Case Number Mismatch: Appraisal case number (${caseNumber}) does not match the active Loan Application case number file. Provide correction.`,
        sourceAuthority: 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'ADMIN_CASE_MATCH'
      });
    }
    if (!highestBestUseYes) {
      list.push({
        id: 'AUTO-HBU',
        category: 'ADMIN',
        text: 'Administrative Alert: The appraiser did not check "Yes" for Highest and Best Use. Provide explanatory underwriting justification before clearance.',
        sourceAuthority: 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'ADMIN_HBU_WARN'
      });
    }
    if (!intendedUseComplies) {
      list.push({
        id: 'AUTO-INTENDED-USE',
        category: 'ADMIN',
        text: 'Administrative Alert: Appraiser Intended Use language is non-conforming to borrower/lender standard credit qualification constraints.',
        sourceAuthority: 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'ADMIN_USE_WARN'
      });
    }

    // Red flag keywords matches pushed as automatic conditions
    detectedKeywords.forEach((match, index) => {
      list.push({
        id: `AUTO-KEYWORD-${match.code}-${index}`,
        category: match.severity === 'ERROR' ? 'REPAIR' : 'INSPECTION',
        text: `Commentary Audit Rule: Match for '${match.word}' found in appraisal commentary. Provide a professional trade certification confirming structural or biological clearance.`,
        sourceAuthority: programType === 'FHA' ? 'FHA_HUD_4000' : 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: match.code
      });
    });

    // 1004MC Market declining check
    const mcPriceDelta = ((mcMedianPriceCurrent3 - mcMedianPricePrior7_12) / mcMedianPricePrior7_12) * 100;
    if (mcPriceDelta < -3.0 && urarNeighborhoodTrend !== 'DECLINING') {
      list.push({
        id: 'AUTO-1004MC-TREND',
        category: 'ADMIN',
        text: `Critical Market Discrepancy: Main Appraisal neighborhood check is marked '${urarNeighborhoodTrend}', but 1004MC stats show a declining trend of ${mcPriceDelta.toFixed(1)}% in median sale prices. Appraiser must explain or reconcile.`,
        sourceAuthority: 'GSE_GUIDELINE',
        isCleared: false,
        prefilledFrom: 'GSE_1004MC_DISCREPANCY'
      });
    }

    return list;
  }, [
    programType,
    metadata.yearBuilt,
    peelingPaintDetected,
    atticInspected,
    crawlspaceInspected,
    utilitiesFunctional,
    septicWellVisualInspection,
    termiteReportAttached,
    wellWaterTested,
    heatingMaintainsFiftyDegrees,
    isManufacturedHome,
    hudCertificationTagPresent,
    hudDataPlatePresent,
    foundationEngineerReportAttached,
    propertyOwnership,
    leaseTermRemainingYears,
    caseNumber,
    caseNumberMatches1003,
    highestBestUseYes,
    intendedUseComplies,
    mcMedianPriceCurrent3,
    mcMedianPricePrior7_12,
    urarNeighborhoodTrend,
    hud928005bCompleted,
    hud928005bValuationMatches,
    isPurchaseLoan,
    purchaseAuditResults,
    nonArmsLengthTransaction,
    contractSellerIsOwnerRecord,
    hasSolarPanels,
    solarOwnership,
    solarValueAdjustmentIncluded,
    solarLeaseIncludedInDti,
    solarAgreementContainsRestrictions,
    detectedKeywords
  ]);

  // Combine automated prefilled list with manual underwriter-pasted conditions
  const combinedNovConditions = useMemo(() => {
    return [...automatedConditions, ...manualConditions];
  }, [automatedConditions, manualConditions]);

  // 3. Dynamic Exceptions / Warnings List for Sidebar Tracker
  const complianceAlerts = useMemo(() => {
    const alerts: { type: 'ERROR' | 'WARNING'; message: string; code: string }[] = [];

    // Pre-1978 Lead
    if (metadata.yearBuilt < 1978 && (programType === 'FHA' || programType === 'VA') && peelingPaintDetected) {
      alerts.push({
        type: 'ERROR',
        code: 'HUD_PRE_1978_LEAD',\n        message: `Property built in ${metadata.yearBuilt} (pre-1978). Peeling exterior paint requires mandatory HUD scraping/sealing.`
      });
    }

    // Head and shoulders physical check
    if ((programType === 'FHA' || programType === 'VA') && (!atticInspected || !crawlspaceInspected)) {
      alerts.push({
        type: 'ERROR',
        code: 'FHA_PHYS_INSPECT',\n        message: 'FHA/VA Mandate: Head & Shoulders attic/crawlspace physical verification is missing.'
      });
    }

    // FHA active utilities
    if (programType === 'FHA' && !utilitiesFunctional) {
      alerts.push({
        type: 'ERROR',
        code: 'FHA_UTILS_OFF',\n        message: 'HUD Mandate: Main structural utilities must be verified active and fully functional.'
      });
    }

    // Well and septic distance
    if ((programType === 'FHA' || programType === 'VA') && !septicWellVisualInspection) {
      alerts.push({
        type: 'WARNING',
        code: 'HUD_SEPTIC_CHECK',
        message: 'FHA/VA Mandate: Appraiser must confirm a visual well/septic layout and safety distance review.'
      });
    }

    // FHA CCDE Form Completed Warnings
    if (programType === 'FHA') {
      if (!hud928005bCompleted) {
        alerts.push({
          type: 'ERROR',
          code: 'HUD_928005B_COMPLETION_REQUIRED',
          message: 'FHA Direct Endorsement Requirement: Form HUD-92800.5B (CCDE) is missing underwriter signatures.'
        });
      }
      if (!hud928005bValuationMatches) {
        alerts.push({
          type: 'ERROR',
          code: 'HUD_928005B_VAL_DISCREPANCY',
          message: 'CCDE Valuation Discrepancy: Valuations on HUD-92800.5B and appraisal report do not match.'
        });
      }
    }

    // Purchase Contract Property Flip Rules
    if (isPurchaseLoan) {
      if (purchaseAuditResults.days <= 90 && programType === 'FHA') {
        alerts.push({
          type: 'ERROR',
          code: 'FHA_90_DAY_FLIP_PROHIBITED',
          message: `Ineligible Property: FHA prohibits mortgage originations on properties flipped within 90 days (${purchaseAuditResults.days} days calculated).`
        });
      } else if (purchaseAuditResults.requireDoubleAppraisal) {
        alerts.push({
          type: 'WARNING',
          code: 'FHA_180_DAY_FLIP_DOUBLE_APPRAISAL',
          message: `FHA Double Appraisal Mandate: Resale price increased by ${purchaseAuditResults.priceIncreasePercent.toFixed(1)}% within 180 days. A second independent appraisal is required.`
        });
      }

      if (nonArmsLengthTransaction) {
        alerts.push({
          type: 'ERROR',
          code: 'CONTRACT_NON_ARMS_LENGTH',
          message: `Non-Arm's Length Sale: Transaction marked as non-arm's length. Verify LTV maximum limits (standard max 85% LTV under HUD rules).`
        });
      }

      if (!contractSellerIsOwnerRecord) {
        alerts.push({
          type: 'ERROR',
          code: 'CONTRACT_SELLER_NOT_OWNER',
          message: 'Chain of Title Warning: Contract seller is NOT listed as current owner of record on page 1 of appraisal.'
        });
      }
    }

    // Leased Solar System Valuation Violations (HUD 4000.1)
    if (hasSolarPanels && solarOwnership === 'LEASED') {
      if (solarValueAdjustmentIncluded) {
        alerts.push({
          type: 'ERROR',
          code: 'SOLAR_LEASE_VAL_VIOLATION',
          message: 'HUD 4000.1 Violations: Contributory valuation adjustments are strictly prohibited for leased/PPA solar systems.'
        });
      }
      if (!solarLeaseIncludedInDti) {
        alerts.push({
          type: 'WARNING',
          code: 'SOLAR_LEASE_DTI_EXCLUSION',
          message: 'Solar lease payments not verified as included in Debt-to-Income (DTI) qualifications.'
        });
      }
    }

    // Red Flag Keywords found in Commentary
    detectedKeywords.forEach((match) => {
      alerts.push({
        type: match.severity,
        code: match.code,
        message: `Keyword Alert in block #${match.blockIndex + 1}: Found "${match.word}" in comments. Specialists trade clearance recommended.`
      });
    });

    // VA Termite check
    if (programType === 'VA' && !termiteReportAttached) {
      alerts.push({
        type: 'WARNING',
        code: 'VA_TERM_INSPECT',\n        message: 'VA MPR Warning: Active regional termite sector. Wood-Destroying Insect (WDI) certificate is required.'
      });
    }

    // VA Well Water
    if (programType === 'VA' && !wellWaterTested) {
      alerts.push({
        type: 'WARNING',
        code: 'VA_WELL_WATER',\n        message: 'VA MPR Warning: Private well requires verified bacteriological potability certificate.'
      });
    }

    // Manufactured Tags
    if (isManufacturedHome) {
      if (!hudCertificationTagPresent || !hudDataPlatePresent) {
        alerts.push({
          type: 'ERROR',
          code: 'HUD_MANUFACTURED_LABEL',\n          message: 'HUD Plate Missing: Manufactured home lacks exterior certification tags or interior data labels.'
        });
      }
      if (!foundationEngineerReportAttached) {
        alerts.push({
          type: 'ERROR',
          code: 'HUD_FOUNDATION_REPORT',\n          message: 'Manufactured Foundation: Certified engineer structural foundation report required.'
        });
      }
    }

    // Leasehold term remaining
    if (propertyOwnership === 'LEASEHOLD' && leaseTermRemainingYears < 15) {
      alerts.push({
        type: 'ERROR',
        code: 'GSE_LEASEHOLD_WINDOW',\n        message: `Lease term mismatch: Remaining term (${leaseTermRemainingYears} yrs) is under the 15-year maturity padding rule.`
      });
    }

    // 1004MC Math check
    const mcPriceDelta = ((mcMedianPriceCurrent3 - mcMedianPricePrior7_12) / mcMedianPricePrior7_12) * 100;
    if (mcPriceDelta < -3.0 && urarNeighborhoodTrend !== 'DECLINING') {
      alerts.push({
        type: 'ERROR',
        code: 'GSE_1004MC_DISCREPANCY',\n        message: `Cross-Form Conflict: 1004MC shows declining price trend (${mcPriceDelta.toFixed(1)}%), but main appraisal claims market is ${urarNeighborhoodTrend}.`
      });
    }

    if (mcMonthsSupplyCurrent3 > 6.0 && urarNeighborhoodTrend !== 'DECLINING') {
      alerts.push({
        type: 'WARNING',
        code: 'GSE_OVERSUPPLY_WARN',\n        message: `Inventory Alert: Months of supply has climbed to ${mcMonthsSupplyCurrent3} months (Oversupply). Review LTV limits.`
      });
    }

    // Comparables rules
    compsData.forEach((comp, idx) => {
      if (idx === 0) return; // Skip Subject

      if (comp.proximityMiles > 1.0) {
        alerts.push({
          type: 'WARNING',
          code: `GSE_DISTANCE_COMP_${idx}`,\n          message: `${comp.propertyType} is ${comp.proximityMiles} miles out. Exceeds standard urban 1.0-mile baseline.`
        });
      }

      const netRatio = (Math.abs(comp.netAdjustment) / comp.salePrice) * 100;
      const grossRatio = (comp.grossAdjustment / comp.salePrice) * 100;

      if (netRatio > 15.0) {
        alerts.push({
          type: 'WARNING',
          code: `GSE_NET_ADJ_COMP_${idx}`,\n          message: `${comp.propertyType} net adjustments (${netRatio.toFixed(1)}%) exceed standard 15% ratio.`
        });
      }

      if (grossRatio > 25.0) {
        alerts.push({
          type: 'WARNING',
          code: `GSE_GROSS_ADJ_COMP_${idx}`,\n          message: `${comp.propertyType} gross adjustments (${grossRatio.toFixed(1)}%) exceed standard 25% ratio.`
        });
      }

      comp.lineItemAdjustments.forEach(adj => {
        const lineRatio = (Math.abs(adj.amount) / comp.salePrice) * 100;
        if (lineRatio > 10.0) {
          alerts.push({
            type: 'WARNING',
            code: `GSE_LINE_ITEM_COMP_${idx}_${adj.field.replace(/\s+/g, '_')}`,\n            message: `${comp.propertyType} line-item for ${adj.field} (${lineRatio.toFixed(1)}%) exceeds 10% threshold.`
          });
        }
      });
    });

    return alerts;
  }, [
    programType,
    metadata.yearBuilt,
    peelingPaintDetected,
    atticInspected,
    crawlspaceInspected,
    utilitiesFunctional,
    septicWellVisualInspection,
    termiteReportAttached,
    wellWaterTested,
    isManufacturedHome,
    hudCertificationTagPresent,
    hudDataPlatePresent,
    foundationEngineerReportAttached,
    propertyOwnership,
    leaseTermRemainingYears,
    mcMedianPriceCurrent3,
    mcMedianPricePrior7_12,
    urarNeighborhoodTrend,
    mcMonthsSupplyCurrent3,
    compsData,
    hud928005bCompleted,
    hud928005bValuationMatches,
    isPurchaseLoan,
    purchaseAuditResults,
    nonArmsLengthTransaction,
    contractSellerIsOwnerRecord,
    hasSolarPanels,
    solarOwnership,
    solarValueAdjustmentIncluded,
    solarLeaseIncludedInDti,
    detectedKeywords
  ]);

  // Handle addition of new manual conditions to Notice of Value card list
  const handleAddManualCondition = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConditionText.trim()) return;

    const newCond: NovCondition = {
      id: `MAN-${Date.now()}`,
      category: newConditionCategory,
      text: newConditionText.trim(),
      sourceAuthority: programType === 'FHA' ? 'FHA_HUD_4000' : programType === 'VA' ? 'VA_PAM_26_7' : 'GSE_GUIDELINE',
      isCleared: false
    };

    setManualConditions([...manualConditions, newCond]);
    setNewConditionText('');
  };

  const removeManualCondition = (id: string) => {
    setManualConditions(manualConditions.filter(c => c.id !== id));
  };

  const toggleConditionCleared = (id: string) => {
    if (id.startsWith('MAN-')) {
      setManualConditions(
        manualConditions.map(c => c.id === id ? { ...c, isCleared: !c.isCleared } : c)
      );
    } else {
      alert("This is an auto-generated regulatory condition. Verify the physical checklists and details are completed to resolve the flag entirely!");
    }
  };

  const handleAddCommentaryBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentaryBlock.trim()) return;
    setCommentaryTextBlocks([...commentaryTextBlocks, newCommentaryBlock.trim()]);
    setNewCommentaryBlock('');
  };

  const removeCommentaryBlock = (idx: number) => {
    setCommentaryTextBlocks(commentaryTextBlocks.filter((_, i) => i !== idx));
  };

  const handleExportToEncompass = () => {
    alert(`Payload Locked & Transmitted to Encompass eFolder successfully!\n\nLocked ${combinedNovConditions.length} Total Conditions.`);
  };

  return (
    <div className="mx-auto max-w-7xl p-6 font-sans space-y-6 text-slate-800 bg-slate-50 min-h-screen">
      
      {/* ==================== 1. COMPREHENSIVE WORKSPACE HEADER ==================== */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-sm gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-7 w-7 text-indigo-600" />
              Appraisal Risk & Underwriting Review
            </h1>
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
              programType === 'VA' ? 'bg-indigo-100 text-indigo-800' : programType === 'FHA' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
            }`}>
              {programType} / SAR LAPP Panel
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Loan ID: <strong className="text-slate-700">{metadata.loanId}</strong></span>
            <span>Borrower: <strong className="text-slate-700">{metadata.borrowerName}</strong></span>
            <span>Effective Date: <strong className="text-slate-700">{metadata.effectiveDate}</strong></span>
          </p>
        </div>

        {/* Agency program selectors */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            <button
              onClick={() => { setProgramType('CONV'); }}
              className={`rounded-md px-3.5 py-1.5 text-xs font-bold uppercase transition ${
                programType === 'CONV' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Conventional
            </button>
            <button
              onClick={() => { setProgramType('FHA'); }}
              className={`rounded-md px-3.5 py-1.5 text-xs font-bold uppercase transition ${
                programType === 'FHA' ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-500 hover:text-orange-600'
              }`}
            >
              FHA / HUD
            </button>
            <button
              onClick={() => { setProgramType('VA'); }}
              className={`rounded-md px-3.5 py-1.5 text-xs font-bold uppercase transition ${
                programType === 'VA' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-indigo-600'
              }`}
            >
              VA Notice of Value
            </button>
          </div>

          {/* Form types */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            <button
              onClick={() => setFormType('FORM_1004')}
              className={`rounded-md px-2.5 py-1.5 text-xs font-bold uppercase transition ${
                formType === 'FORM_1004' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              1004 URAR
            </button>
            <button
              onClick={() => setFormType('FORM_1073')}
              className={`rounded-md px-2.5 py-1.5 text-xs font-bold uppercase transition ${
                formType === 'FORM_1073' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              1073 Condo
            </button>
            <button
              onClick={() => setFormType('FORM_1025')}
              className={`rounded-md px-2.5 py-1.5 text-xs font-bold uppercase transition ${
                formType === 'FORM_1025' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              1025 Multi-Fam
            </button>
          </div>
        </div>
      </div>

      {/* ==================== 2. CRITICAL CASE METADATA & ADMINISTRATIVE HEADER PANEL ==================== */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">FHA/VA Case Number</label>
          <input 
            type="text" 
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
            className="w-full rounded-md border border-slate-300 p-2 text-xs font-semibold focus:border-blue-500 focus:outline-none"
          />
          <div className="flex items-center gap-1.5 mt-2">
            <button 
              onClick={() => setCaseNumberMatches1003(!caseNumberMatches1003)}
              className="focus:outline-none"
            >
              {caseNumberMatches1003 ? <CheckSquare className=\"h-3.5 w-3.5 text-emerald-600\" /> : <Square className=\"h-3.5 w-3.5 text-slate-300\" />}
            </button>
            <span className="text-[10px] text-slate-500">Matches 1003 loan file</span>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">Property Ownership</label>
          <select
            value={propertyOwnership}
            onChange={(e) => setPropertyOwnership(e.target.value as any)}
            className="w-full rounded-md border border-slate-300 p-2 text-xs font-semibold bg-white focus:outline-none"
          >
            <option value="FEE_SIMPLE">Fee Simple</option>
            <option value="LEASEHOLD">Leasehold</option>
          </select>
          {propertyOwnership === 'LEASEHOLD' && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                value={leaseTermRemainingYears}
                onChange={(e) => setLeaseTermRemainingYears(Number(e.target.value))}
                className="w-16 rounded border border-slate-300 p-1 text-xs text-center"
              />
              <span className="text-[10px] text-slate-500">Remaining Yrs</span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">Highest & Best Use Check</label>
          <div className="flex rounded border border-slate-200 bg-slate-100 p-1 w-fit mt-1">
            <button
              onClick={() => setHighestBestUseYes(true)}
              className={`rounded px-2.5 py-1 text-[10px] font-bold ${highestBestUseYes ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
            >
              Yes
            </button>
            <button
              onClick={() => setHighestBestUseYes(false)}
              className={`rounded px-2.5 py-1 text-[10px] font-bold ${!highestBestUseYes ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-500'}`}
            >
              No (Warning)
            </button>
          </div>
          <span className="block mt-1 text-[9px] text-slate-400">Must reflect legal/highest utility</span>
        </div>

        <div>
          <label className="block text-[10px] font-extrabold uppercase text-slate-400 mb-1">Intended Use Review</label>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => setIntendedUseComplies(!intendedUseComplies)}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${intendedUseComplies ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}
            >
              {intendedUseComplies ? 'Compliant Intended Use' : 'Non-Conforming Language'}
            </button>
          </div>
        </div>
      </div>

      {/* ==================== 3. THREE-COLUMN ACTIVE SYSTEM LAYOUT ==================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* ==================== LEFT COLUMN: OCR & PDF HIGHLIGHT OVERLAY SIDEBAR ==================== */}
        <div className="xl:col-span-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-blue-500" />
                <h2 className="font-extrabold text-slate-900 text-sm">Interactive PDF Coordinate Map</h2>
              </div>
              <span className="text-[9px] text-slate-400 font-mono">ZDR RAM BUFFER</span>
            </div>

            {/* Simulated Bounded Field Layout */}
            <div className="relative rounded-lg border border-slate-300 bg-slate-900 h-96 w-full overflow-hidden flex items-center justify-center">
              <div className="absolute inset-0 bg-white opacity-10 p-4 font-mono text-[7px] leading-tight select-none pointer-events-none text-white">
                {Array.from({ length: 45 }).map((_, i) => (
                  <div key={i} className="whitespace-nowrap">
                    APPRAISAL REPORT ADDENDUMS -- MARKET CONDITIONS FORM 1004MC -- SECTION J COORDS EXTRACTED...
                  </div>
                ))}
              </div>

              {/* Grid Column Rectangles that Highlight on Hover/Select */}
              <div className="absolute inset-0 grid grid-cols-4 p-2 gap-2">
                {compsData.map((comp, idx) => (
                  <div 
                    key={idx}
                    onMouseEnter={() => setHighlightColumn(comp.propertyType)}
                    onMouseLeave={() => setHighlightColumn(null)}
                    className={`relative rounded border-2 border-dashed flex flex-col justify-between p-2 transition-all cursor-pointer ${
                      highlightColumn === comp.propertyType 
                        ? 'border-blue-400 bg-blue-500/20 shadow-lg scale-[1.02]' 
                        : 'border-slate-700 bg-slate-800/40 hover:border-slate-500 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="text-[9px] font-extrabold text-white bg-slate-700 px-1.5 py-0.5 rounded shadow-sm w-fit">
                      {comp.propertyType}
                    </div>

                    <div className="space-y-1 text-center bg-slate-900/95 rounded p-1 shadow-sm border border-slate-700">
                      <p className="text-[8px] font-bold truncate text-slate-200">{comp.address.split(',')[0]}</p>
                      <p className="text-[11px] font-extrabold text-blue-400">
                        {comp.salePrice > 0 ? `$${comp.salePrice.toLocaleString()}` : 'SUBJECT'}
                      </p>
                      <p className="text-[8px] text-slate-400">{comp.gla} Sq Ft</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 text-[11px] text-slate-500 flex items-start gap-1.5">
              <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <span>Hover column segments above to link parsed OCR bounds directly with coordinate layers.</span>
            </div>
          </div>

          {/* Appraiser Licensing details */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-1.5 text-sm">
              <UserCheck className="h-4.5 w-4.5 text-emerald-500" />
              Appraiser State Certification
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Appraiser Name</span>
                <span className="font-bold text-slate-800">{metadata.appraiserName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">State License / License No</span>
                <span className="font-bold text-slate-800">{metadata.appraiserLicense}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Construction Year</span>
                <span className="font-bold text-slate-800">{metadata.yearBuilt} (Pre-1978 HUD Lead Risk)</span>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== MIDDLE COLUMN: TABS WITH GRIDS, 1004MC, AND MPR CHECKLISTS ==================== */}
        <div className="xl:col-span-8 space-y-6">
          
          {/* Dynamic Tab Selector */}
          <div className="flex flex-wrap border-b border-slate-200 bg-white rounded-lg p-1.5 shadow-sm gap-1">
            <button
              onClick={() => setActiveTab('GRID')}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase rounded-md transition-all ${
                activeTab === 'GRID' 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              Comps Grid
            </button>
            <button
              onClick={() => setActiveTab('1004MC')}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase rounded-md transition-all ${
                activeTab === '1004MC' 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <FileSpreadsheet className="h-4 w-4" />
              1004MC Trends
            </button>
            <button
              onClick={() => setActiveTab('CHECKLIST')}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase rounded-md transition-all ${
                activeTab === 'CHECKLIST' 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Wrench className="h-4 w-4" />
              HUD / VA MPR
            </button>
            <button
              onClick={() => setActiveTab('CONTRACT_AUDIT')}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase rounded-md transition-all ${
                activeTab === 'CONTRACT_AUDIT' 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Calendar className="h-4 w-4" />
              Purchase & Flips
            </button>
            <button
              onClick={() => setActiveTab('COMMENTARY')}
              className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase rounded-md transition-all ${
                activeTab === 'COMMENTARY' 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <FileText className="h-4 w-4" />
              Commentary Scanner
            </button>
          </div>

          {/* ==================== TAB 1: COMPARATIVE SALES GRID ==================== */}
          {activeTab === 'GRID' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm overflow-hidden space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-slate-900 flex items-center gap-2 text-base">
                  <ClipboardList className="h-5 w-5 text-blue-500" />
                  Comparative Sales Grid Comparison
                </h2>
                <span className="text-xs text-slate-400">HUD allowable variance scan active</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-semibold text-slate-500 border-b border-slate-100">
                      <th className="p-3">Analytical Property Field</th>
                      {compsData.map((comp) => (
                        <th 
                          key={comp.propertyType}
                          className={`p-3 transition-colors ${
                            highlightColumn === comp.propertyType ? 'bg-blue-50 text-blue-900' : ''
                          }`}
                        >
                          {comp.propertyType}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    <tr className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-600">Address</td>
                      {compsData.map((comp) => (
                        <td 
                          key={comp.propertyType}
                          className={`p-3 font-medium transition-colors ${
                            highlightColumn === comp.propertyType ? 'bg-blue-50/50' : ''
                          }`}
                        >
                          {comp.address}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-600">Sale Price</td>
                      {compsData.map((comp) => (
                        <td 
                          key={comp.propertyType}
                          className={`p-3 font-bold transition-colors ${
                            comp.salePrice > 0 ? 'text-slate-900' : 'text-slate-500'
                          } ${highlightColumn === comp.propertyType ? 'bg-blue-50/50' : ''}`}
                        >
                          {comp.salePrice > 0 ? `$${comp.salePrice.toLocaleString()}` : 'N/A (Subject)'}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-600">Proximity to Subject</td>
                      {compsData.map((comp) => (
                        <td 
                          key={comp.propertyType}
                          className={`p-3 font-semibold transition-colors ${
                            comp.proximityMiles > 1.0 ? 'text-orange-600 font-bold' : 'text-slate-800'
                          } ${highlightColumn === comp.propertyType ? 'bg-blue-50/50' : ''}`}
                        >
                          {comp.proximityMiles > 0 ? `${comp.proximityMiles} Miles` : '0.0 Miles (Subject)'}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-600">Gross Living Area (GLA)</td>
                      {compsData.map((comp) => (
                        <td 
                          key={comp.propertyType}
                          className={`p-3 font-semibold transition-colors ${
                            highlightColumn === comp.propertyType ? 'bg-blue-50/50' : ''
                          }`}
                        >
                          {comp.gla.toLocaleString()} Sq Ft
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-100 bg-slate-50/30">
                      <td className="p-3 font-semibold text-slate-600">Net Adjustments</td>
                      {compsData.map((comp) => {
                        const ratio = comp.salePrice > 0 ? (comp.netAdjustment / comp.salePrice) * 100 : 0;
                        return (
                          <td 
                            key={comp.propertyType}
                            className={`p-3 font-bold transition-colors ${
                              Math.abs(ratio) > 15 ? 'text-red-600' : 'text-slate-800'
                            } ${highlightColumn === comp.propertyType ? 'bg-blue-50/50' : ''}`}
                          >
                            {comp.salePrice > 0 ? (
                              <div className="flex flex-col">
                                <span>${comp.netAdjustment.toLocaleString()}</span>
                                <span className="text-[10px] text-slate-400 font-medium">({ratio.toFixed(1)}%)</span>
                              </div>
                            ) : '0.0 (Subject)'}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-b border-slate-100 bg-slate-50/30">
                      <td className="p-3 font-semibold text-slate-600">Gross Adjustments</td>
                      {compsData.map((comp) => {
                        const ratio = comp.salePrice > 0 ? (comp.grossAdjustment / comp.salePrice) * 100 : 0;
                        return (
                          <td 
                            key={comp.propertyType}
                            className={`p-3 font-extrabold transition-colors ${
                              ratio > 25 ? 'text-red-600' : 'text-slate-800'
                            } ${highlightColumn === comp.propertyType ? 'bg-blue-50/50' : ''}`}
                          >
                            {comp.salePrice > 0 ? (
                              <div className="flex flex-col">
                                <span>${comp.grossAdjustment.toLocaleString()}</span>
                                <span className="text-[10px] text-slate-400 font-medium">({ratio.toFixed(1)}%)</span>
                              </div>
                            ) : '0.0 (Subject)'}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== TAB 2: 1004MC MARKET CONDITIONS ADDENDUM ==================== */}
          {activeTab === '1004MC' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">1004MC Market Conditions Addendum</h3>
                  <p className="text-xs text-slate-400 mt-1">Cross-validation trends with Page 1 of the appraisal</p>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1.5">
                  <span className="text-[10px] font-bold uppercase text-slate-500 px-1">URAR Page 1 Trend:</span>
                  <select
                    value={urarNeighborhoodTrend}
                    onChange={(e) => setUrarNeighborhoodTrend(e.target.value as any)}
                    className="text-xs font-bold uppercase rounded border border-slate-300 bg-white px-2 py-0.5 focus:outline-none"
                  >
                    <option value="INCREASING">Increasing</option>
                    <option value="STABLE">Stable</option>
                    <option value="DECLINING">Declining</option>
                  </select>
                </div>
              </div>

              {/* 1004MC Modifiable Inputs for Analysis */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Median Price (7-12 Months)</label>
                  <input
                    type="number"
                    value={mcMedianPricePrior7_12}
                    onChange={(e) => setMcMedianPricePrior7_12(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 text-xs font-semibold focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Median Price (4-6 Months)</label>
                  <input
                    type="number"
                    value={mcMedianPricePrior4_6}
                    onChange={(e) => setMcMedianPricePrior4_6(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 text-xs font-semibold focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Median Price (Current 0-3 Months)</label>
                  <input
                    type="number"
                    value={mcMedianPriceCurrent3}
                    onChange={(e) => setMcMedianPriceCurrent3(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 text-xs font-semibold focus:outline-none"
                  />
                </div>
              </div>

              {/* Statistical trends visualization table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 text-[10px] uppercase font-bold">
                      <th className="pb-2">Inventory Matrix Category</th>
                      <th className="pb-2">Prior 7-12 Months</th>
                      <th className="pb-2">Prior 4-6 Months</th>
                      <th className="pb-2">Current 0-3 Months</th>
                      <th className="pb-2">Calculated Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="py-3.5 font-bold">Total Comparable Active Listings</td>
                      <td className="py-3.5">42</td>
                      <td className="py-3.5">51</td>
                      <td className="py-3.5">68</td>
                      <td className="py-3.5 text-rose-600 font-bold">Increasing Supply</td>
                    </tr>
                    <tr>
                      <td className="py-3.5 font-bold">Months of Supply (Absorption)</td>
                      <td className="py-3.5">3.5 Months</td>
                      <td className="py-3.5">4.8 Months</td>
                      <td className="py-3.5 flex items-center gap-2">
                        <input
                          type="number"
                          step="0.1"
                          value={mcMonthsSupplyCurrent3}
                          onChange={(e) => setMcMonthsSupplyCurrent3(Number(e.target.value))}
                          className="w-16 rounded border border-slate-300 p-1 text-xs text-center font-bold"
                        />
                        <span>Months</span>
                      </td>
                      <td className="py-3.5 text-rose-600 font-bold">
                        {mcMonthsSupplyCurrent3 > 6.0 ? 'Oversupply (> 6.0)' : 'In Balance'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3.5 font-bold">Median Comparable Sale Price</td>
                      <td className="py-3.5">${mcMedianPricePrior7_12.toLocaleString()}</td>
                      <td className="py-3.5">${mcMedianPricePrior4_6.toLocaleString()}</td>
                      <td className="py-3.5">${mcMedianPriceCurrent3.toLocaleString()}</td>
                      <td className="py-3.5 text-rose-600 font-bold">
                        Declining Price ({(((mcMedianPriceCurrent3 - mcMedianPricePrior7_12) / mcMedianPricePrior7_12) * 100).toFixed(1)}%)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== TAB 3: PHYSICAL HUD / VA MPR CHECKLISTS ==================== */}
          {activeTab === 'CHECKLIST' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Physical Property Compliance</h3>
                  <p className="text-xs text-slate-400 mt-1">Check off inspected items to clear associated HUD and VA requirements</p>
                </div>

                {programType === 'FHA' && (
                  <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 p-2 rounded-lg">
                    <button onClick={() => setHud928005bCompleted(!hud928005bCompleted)} className="focus:outline-none">
                      {hud928005bCompleted ? <CheckSquare className="h-4.5 w-4.5 text-orange-600" /> : <Square className="h-4.5 w-4.5 text-slate-300" />}
                    </button>
                    <span className="text-[10px] font-extrabold text-orange-800 uppercase">HUD-92800.5B (CCDE) Signed</span>
                  </div>
                )}
              </div>

              {/* FHA 4000.1 checklist */}
              <div className="space-y-4">
                <div className="border-b border-slate-100 pb-2 flex justify-between items-center">
                  <h4 className="text-xs font-extrabold text-orange-600 uppercase tracking-wider">FHA HUD Handbook 4000.1 Requirements</h4>
                  {programType === 'FHA' && (
                    <div className="flex gap-4 text-[10px] font-bold text-slate-500 uppercase">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={hud928005bValuationMatches} onChange={() => setHud928005bValuationMatches(!hud928005bValuationMatches)} />
                        <span>CCDE Value Matches</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={hud928005bExpirationValid} onChange={() => setHud928005bExpirationValid(!hud928005bExpirationValid)} />
                        <span>CCDE Expiration Valid</span>
                      </label>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-xs text-slate-800">Attic Visual Inspection</p>
                      <p className="text-[10px] text-slate-400">Verify head & shoulders physical viewing</p>
                    </div>
                    <button onClick={() => setAtticInspected(!atticInspected)} className="focus:outline-none">
                      {atticInspected ? <CheckSquare className="h-5 w-5 text-emerald-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-xs text-slate-800">Crawlspace Visual Inspection</p>
                      <p className="text-[10px] text-slate-400">Verify crawlspace head & shoulders access</p>
                    </div>
                    <button onClick={() => setCrawlspaceInspected(!crawlspaceInspected)} className="focus:outline-none">
                      {crawlspaceInspected ? <CheckSquare className="h-5 w-5 text-emerald-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-xs text-slate-800">Core Utilities Fully Active</p>
                      <p className="text-[10px] text-slate-400">Water, electricity, gas verified operational</p>
                    </div>
                    <button onClick={() => setUtilitiesFunctional(!utilitiesFunctional)} className="focus:outline-none">
                      {utilitiesFunctional ? <CheckSquare className="h-5 w-5 text-emerald-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-xs text-slate-800">Well & Septic Separation Visual Survey</p>
                      <p className="text-[10px] text-slate-400">Verify appraiser validated separation distances</p>
                    </div>
                    <button onClick={() => setSepticWellVisualInspection(!septicWellVisualInspection)} className="focus:outline-none">
                      {septicWellVisualInspection ? <CheckSquare className="h-5 w-5 text-emerald-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-xs text-slate-800">Pre-1978 Lead Paint Danger</p>
                      <p className="text-[10px] text-slate-400">Exterior peeling paint observed on woodwork</p>
                    </div>
                    <button onClick={() => setPeelingPaintDetected(!peelingPaintDetected)} className="focus:outline-none">
                      {!peelingPaintDetected ? <CheckSquare className="h-5 w-5 text-emerald-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Solar Panel energy systems validation checks */}
              <div className="space-y-4 pt-2">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-blue-600 uppercase tracking-wider">HUD / GSE Solar Panel Overlays</h4>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-extrabold text-slate-500 uppercase">
                      <input type="checkbox" checked={hasSolarPanels} onChange={() => setHasSolarPanels(!hasSolarPanels)} />
                      <span>Has Solar panels</span>
                    </label>
                    {hasSolarPanels && (
                      <select 
                        value={solarOwnership} 
                        onChange={(e) => setSolarOwnership(e.target.value as any)}
                        className="text-[10px] font-extrabold uppercase border rounded bg-white p-1"
                      >
                        <option value="LEASED">Leased / PPA</option>
                        <option value="OWNED">Owned outright</option>
                      </select>
                    )}
                  </div>
                </div>

                {hasSolarPanels && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-blue-50/40 p-4 rounded-lg border border-blue-100">
                    {solarOwnership === 'LEASED' && (
                      <>
                        <div className="flex items-center justify-between p-3 bg-white rounded border border-blue-100">
                          <div>
                            <p className="font-bold text-xs text-slate-800">Removed Contributory Value</p>
                            <p className="text-[9px] text-slate-400">Leased panels cannot contribute to value</p>
                          </div>
                          <button onClick={() => setSolarAppraisalValueAdjustmentIncluded(!solarValueAdjustmentIncluded)} className="focus:outline-none">
                            {!solarValueAdjustmentIncluded ? <CheckSquare className="h-5 w-5 text-blue-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                          </button>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white rounded border border-blue-100">
                          <div>
                            <p className="font-bold text-xs text-slate-800">Lease Included in DTI</p>
                            <p className="text-[9px] text-slate-400">Payments added to borrower liability</p>
                          </div>
                          <button onClick={() => setSolarLeaseIncludedInDti(!solarLeaseIncludedInDti)} className="focus:outline-none">
                            {solarLeaseIncludedInDti ? <CheckSquare className="h-5 w-5 text-blue-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                          </button>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white rounded border border-blue-100">
                          <div>
                            <p className="font-bold text-xs text-slate-800">No Transfer Restrictions</p>
                            <p className="text-[9px] text-slate-400">Fully transferable to new home buyer</p>
                          </div>
                          <button onClick={() => setSolarAgreementContainsRestrictions(!solarAgreementContainsRestrictions)} className="focus:outline-none">
                            {!solarAgreementContainsRestrictions ? <CheckSquare className="h-5 w-5 text-blue-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                          </button>
                        </div>
                      </>
                    )}
                    {solarOwnership === 'OWNED' && (
                      <div className="col-span-3 p-2 bg-emerald-50 rounded border border-emerald-100 text-xs text-emerald-800 flex items-center gap-2 font-semibold">
                        <CheckSquare className="h-4.5 w-4.5 text-emerald-600" />
                        <span>System is owned outright. VA SAR requires validation of operational and electrical safety certifications.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* FHA Manufactured Housing rules */}
              <div className="space-y-4 pt-2">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-orange-600 uppercase tracking-wider">FHA Manufactured Housing Special Overlays</h4>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setIsManufacturedHome(!isManufacturedHome)} className="focus:outline-none">
                      {isManufacturedHome ? <CheckSquare className="h-4 w-4 text-orange-600" /> : <Square className="h-4 w-4 text-slate-300" />}
                    </button>
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase">This is a Manufactured Home</span>
                  </div>
                </div>

                {isManufacturedHome && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-orange-50/50 p-4 rounded-lg border border-orange-100">
                    <div className="flex items-center justify-between p-3 bg-white rounded border border-orange-100">
                      <div>
                        <p className="font-bold text-xs text-slate-800">HUD Exterior Red Tags</p>
                        <p className="text-[9px] text-slate-400">Verification label present</p>
                      </div>
                      <button onClick={() => setHudCertificationTagPresent(!hudCertificationTagPresent)} className="focus:outline-none">
                        {hudCertificationTagPresent ? <CheckSquare className="h-5 w-5 text-orange-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white rounded border border-orange-100">
                      <div>
                        <p className="font-bold text-xs text-slate-800">HUD Interior Data Plate</p>
                        <p className="text-[9px] text-slate-400">Paper compliance map visible</p>
                      </div>
                      <button onClick={() => setHudDataPlatePresent(!hudDataPlatePresent)} className="focus:outline-none">
                        {hudDataPlatePresent ? <CheckSquare className="h-5 w-5 text-orange-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white rounded border border-orange-100">
                      <div>
                        <p className="font-bold text-xs text-slate-800">Foundation Engineer Report</p>
                        <p className="text-[9px] text-slate-400">Certifies compliance with PFGMH-96</p>
                      </div>
                      <button onClick={() => setFoundationEngineerReportAttached(!foundationEngineerReportAttached)} className="focus:outline-none">
                        {foundationEngineerReportAttached ? <CheckSquare className="h-5 w-5 text-orange-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* VA Pamphlet 26-7 checklist */}
              <div className="space-y-4 pt-2">
                <div className="border-b border-slate-100 pb-2">
                  <h4 className="text-xs font-extrabold text-indigo-600 uppercase tracking-wider">VA Pamphlet 26-7 Minimum Property Requirements (MPRs)</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-xs text-slate-800">Wood Destroying Insects (WDI)</p>
                      <p className="text-[10px] text-slate-400">Termite report clear & uploaded</p>
                    </div>
                    <button onClick={() => setTermiteReportAttached(!termiteReportAttached)} className="focus:outline-none">
                      {termiteReportAttached ? <CheckSquare className="h-5 w-5 text-indigo-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-xs text-slate-800">Private Well Potability Certified</p>
                      <p className="text-[10px] text-slate-400">Bacteriological/chemical test uploaded</p>
                    </div>
                    <button onClick={() => setWellWaterTested(!wellWaterTested)} className="focus:outline-none">
                      {wellWaterTested ? <CheckSquare className="h-5 w-5 text-indigo-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-xs text-slate-800">Heating System MPR Met</p>
                      <p className="text-[10px] text-slate-400">Maintains 50 degrees F in all areas</p>
                    </div>
                    <button onClick={() => setHeatingMaintainsFiftyDegrees(!heatingMaintainsFiftyDegrees)} className="focus:outline-none">
                      {heatingMaintainsFiftyDegrees ? <CheckSquare className="h-5 w-5 text-indigo-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== TAB 4: PURCHASE CONTRACT & PROPERTY FLIPS ==================== */}
          {activeTab === 'CONTRACT_AUDIT' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-blue-600" />
                    Purchase Contract & FHA Flip Rules Engine
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Parses purchase agreements and prior transfer chains to detect flip exceptions and non-arm's length sales</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setIsPurchaseLoan(!isPurchaseLoan)} className="focus:outline-none">
                    {isPurchaseLoan ? <CheckSquare className="h-4.5 w-4.5 text-blue-600" /> : <Square className="h-4.5 w-4.5 text-slate-300" />}
                  </button>
                  <span className="text-xs font-bold text-slate-600 uppercase">Is Purchase Transaction</span>
                </div>
              </div>

              {isPurchaseLoan ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Contract Execution Date</label>
                      <input 
                        type="date" 
                        value={contractDateStr} 
                        onChange={(e) => setContractDateStr(e.target.value)}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Prior Transfer Date (Seller Bought)</label>
                      <input 
                        type="date" 
                        value={priorSaleDateStr} 
                        onChange={(e) => setPriorSaleDateStr(e.target.value)}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Prior Acquisition Price</label>
                      <input 
                        type="number" 
                        value={priorSalePrice} 
                        onChange={(e) => setPriorSalePrice(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Current Resale Contract Price</label>
                      <div className="p-2 border rounded border-slate-300 bg-white font-bold text-slate-700">
                        ${(compsData[1]?.salePrice || 425000).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Programmatic calculations presentation */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-slate-200 p-4 flex flex-col justify-between space-y-2">
                      <div>
                        <h4 className="text-xs font-bold text-slate-700 uppercase">FHA 90/180-Day Flip Audit</h4>
                        <p className="text-[11px] text-slate-400 mt-1">HUD Handbook 4000.1 restricts financing on quickly flipped properties</p>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between py-1 border-b">
                          <span className="text-slate-500">Days Since Last Transfer</span>
                          <span className={`font-bold ${purchaseAuditResults.days <= 90 ? 'text-rose-600' : 'text-slate-800'}`}>
                            {purchaseAuditResults.days} Days
                          </span>
                        </div>
                        <div className="flex justify-between py-1 border-b">
                          <span className="text-slate-500">Value Appreciation</span>
                          <span className="font-bold text-slate-800">
                            +{purchaseAuditResults.priceIncreasePercent.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-500">Eligibility Check</span>
                          {purchaseAuditResults.days <= 90 ? (
                            <span className="font-extrabold text-rose-600 flex items-center gap-1 uppercase text-[10px]">
                              <AlertOctagon className="h-3.5 w-3.5" /> FHA Ineligible
                            </span>
                          ) : purchaseAuditResults.requireDoubleAppraisal ? (
                            <span className="font-extrabold text-amber-600 flex items-center gap-1 uppercase text-[10px]">
                              <AlertTriangle className="h-3.5 w-3.5" /> Second Appraisal Required
                            </span>
                          ) : (
                            <span className="font-extrabold text-emerald-600 flex items-center gap-1 uppercase text-[10px]">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Clean Transfer Range
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-4 space-y-3 flex flex-col justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-slate-700 uppercase">Transaction Relationship Reviews</h4>
                        <p className="text-[11px] text-slate-400 mt-1">Identifies arm's length legitimacy and contract seller deed matches</p>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                          <div>
                            <p className="font-bold text-slate-800">Seller of Record is Owner on Deed</p>
                            <p className="text-[10px] text-slate-400">Matches current county land title ledger</p>
                          </div>
                          <button onClick={() => setContractSellerIsOwnerRecord(!contractSellerIsOwnerRecord)} className="focus:outline-none">
                            {contractSellerIsOwnerRecord ? <CheckSquare className="h-5 w-5 text-emerald-600" /> : <Square className="h-5 w-5 text-rose-600" />}
                          </button>
                        </div>

                        <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                          <div>
                            <p className="font-bold text-slate-800">Non-Arm's Length Transaction</p>
                            <p className="text-[10px] text-slate-400">Buyer and seller are related, business partners, or employer</p>
                          </div>
                          <button onClick={() => setNonArmsLengthTransaction(!nonArmsLengthTransaction)} className="focus:outline-none">
                            {nonArmsLengthTransaction ? <CheckSquare className="h-5 w-5 text-rose-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 bg-slate-50 rounded-lg text-slate-400 text-xs italic">
                  Property is collateral for a Refinance loan. Purchase Contract audit overlays are disabled.
                </div>
              )}
            </div>
          )}

          {/* ==================== TAB 5: COMMENTARY Scanner ==================== */}
          {activeTab === 'COMMENTARY' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Search className="h-5 w-5 text-indigo-600" />
                    Commentary Red Flag Scanner
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Scans raw appraisal commentary blocks for critical liability words (mold, structural, dampness, crack, infestation)</p>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase bg-rose-50 text-rose-700 px-3 py-1 rounded-full">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Matches Flagged: {detectedKeywords.length}</span>
                </div>
              </div>

              {/* Text Blocks Listing */}
              <div className="space-y-4">
                {commentaryTextBlocks.map((block, idx) => {
                  // Check if this block contains matches
                  const blockMatches = detectedKeywords.filter(m => m.blockIndex === idx);
                  const isMatch = blockMatches.length > 0;

                  return (
                    <div 
                      key={idx} 
                      className={`p-4 rounded-lg border text-xs relative ${
                        isMatch ? 'bg-rose-50/40 border-rose-200' : 'bg-slate-50/30 border-slate-100'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-extrabold text-slate-500 uppercase text-[9px]">Paragraph #{idx + 1}</span>
                        <div className="flex items-center gap-2">
                          {isMatch && (
                            <span className="text-[8px] font-extrabold bg-rose-100 text-rose-800 rounded px-1.5 py-0.5 uppercase tracking-wider">
                              Red Flag Match: {blockMatches.map(m => m.word).join(', ')}
                            </span>
                          )}
                          <button 
                            onClick={() => removeCommentaryBlock(idx)}
                            className="text-slate-400 hover:text-red-500 font-bold"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Display paragraph with keyword highlighted */}
                      <p className="text-slate-700 font-medium leading-relaxed">
                        {block}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Add commentary simulation box */}
              <form onSubmit={handleAddCommentaryBlock} className="border-t pt-4 space-y-3">
                <h4 className="text-xs font-extrabold text-slate-700 uppercase flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  Simulate New Appraisal Commentary Box
                </h4>
                <div className="flex flex-col md:flex-row gap-3">
                  <textarea
                    value={newCommentaryBlock}
                    onChange={(e) => setNewCommentaryBlock(e.target.value)}
                    placeholder="Type or paste appraisal text box commentary. (Try typing 'mold', 'structural integrity problems', 'severe basement dampness', or 'termite infestation')..."
                    className="flex-1 text-xs rounded border border-slate-300 p-2.5 focus:border-indigo-500 focus:outline-none"
                    rows={2}
                  />
                  <button
                    type="submit"
                    className="rounded bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 text-xs font-bold uppercase transition self-end"
                  >
                    Scan Commentary
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ==================== BOTTOM GRID: REAL-TIME AUDIT EXCEPTIONS LOG ==================== */}
          {complianceAlerts.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600" />
                <h3 className="font-extrabold text-rose-900 text-sm">Active Compliance Flag Warnings ({complianceAlerts.length})</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto">
                {complianceAlerts.map((alert) => (
                  <div key={alert.code} className="flex gap-2.5 bg-white p-3 rounded-lg border border-rose-100 text-xs shadow-sm">
                    <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase self-start ${
                      alert.type === 'ERROR' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {alert.type}
                    </span>
                    <p className="text-slate-700 leading-relaxed font-semibold">
                      <strong className="text-slate-900">{alert.code}:</strong> {alert.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================== 4. INTEGRATED VA NOTICE OF VALUE (NOV) & HUD REPAIRS BUNDLER ==================== */}
      <div className="grid grid-cols-1 gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <ClipboardList className="h-5.5 w-5.5 text-indigo-600" />
                VA Notice of Value (NOV) & HUD Repair Conditions Bundle
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Prefilled dynamic conditions based on automated rules. Commits to Encompass eFolder as outstanding disclosures.
              </p>
            </div>
            <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full font-bold">
              Total Active Conditions: {combinedNovConditions.length}
            </span>
          </div>

          {/* Condition Cards Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {combinedNovConditions.map((condition) => (
              <div 
                key={condition.id} 
                className={`rounded-lg border p-4.5 text-xs flex flex-col justify-between transition-all ${
                  condition.isCleared 
                    ? 'bg-slate-50 border-slate-200 opacity-60' 
                    : condition.id.startsWith('AUTO-') 
                      ? 'bg-indigo-50/40 border-indigo-100 hover:border-indigo-200' 
                      : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => toggleConditionCleared(condition.id)}
                        className="focus:outline-none"
                      >
                        {condition.isCleared ? (
                          <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                        ) : (
                          <div className="h-4.5 w-4.5 rounded-full border-2 border-slate-300 bg-white" />
                        )}
                      </button>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase ${
                        condition.category === 'REPAIR' 
                          ? 'bg-rose-100 text-rose-800' 
                          : condition.category === 'INSPECTION' 
                            ? 'bg-amber-100 text-amber-800' 
                            : 'bg-blue-100 text-blue-800'
                      }`}>
                        {condition.category}
                      </span>
                    </div>

                    {/* Delete button if manual */}
                    {condition.id.startsWith('MAN-') && (
                      <button 
                        onClick={() => removeManualCondition(condition.id)}
                        className="text-slate-400 hover:text-red-500 flex-shrink-0 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <p className={`text-slate-700 leading-relaxed font-semibold ${condition.isCleared ? 'line-through text-slate-400' : ''}`}>
                    {condition.text}
                  </p>
                </div>

                <div className="border-t border-slate-100 pt-2.5 mt-3 flex items-center justify-between text-[9px] text-slate-400 uppercase font-bold">
                  <span>Authority: {condition.sourceAuthority.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-[8px]">{condition.id}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Add custom manual condition formulation box */}
          <form onSubmit={handleAddManualCondition} className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-3">
            <h4 className="text-xs font-extrabold text-slate-700 uppercase">Manually Draft Additional Condition Form</h4>
            <div className="flex flex-col md:flex-row gap-3">
              <textarea
                value={newConditionText}
                onChange={(e) => setNewConditionText(e.target.value)}
                placeholder="Draft custom repairs, inspections, or additional administrative clearance item verbiage..."
                className="flex-1 text-xs rounded border border-slate-300 p-2.5 focus:border-indigo-500 focus:outline-none"
                rows={2}
              />
              <div className="flex flex-col gap-2 justify-between min-w-[200px]\">
                <select
                  value={newConditionCategory}
                  onChange={(e) => setNewConditionCategory(e.target.value as any)}
                  className="text-xs font-bold uppercase rounded border border-slate-300 bg-white p-2 focus:outline-none"
                >
                  <option value="REPAIR">Physical Repair</option>
                  <option value="INSPECTION">Inspection / Lab Cert</option>
                  <option value="ADMIN">Administrative Check</option>
                </select>
                <button
                  type="submit"
                  className="rounded bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 text-xs font-bold uppercase transition"
                >
                  Add Custom Condition
                </button>
              </div>
            </div>
          </form>

          {/* Lock & Sync to Encompass */}
          <div className="flex flex-col md:flex-row items-center justify-between bg-slate-900 text-white p-5 rounded-xl border border-slate-800">
            <div>
              <h3 className="font-bold text-sm">Lock, Release & Sync Final NOV</h3>
              <p className="text-xs text-slate-400 mt-1">
                Commits and locks {combinedNovConditions.filter(c => !c.isCleared).length} outstanding conditions directly to Encompass.
              </p>
            </div>
            <button
              onClick={handleExportToEncompass}
              className="mt-3 md:mt-0 flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 text-xs font-bold uppercase tracking-wider transition shadow-lg"
            >
              Sign & Sync Encompass eFolder <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
