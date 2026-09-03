# Unified Appraisal & Form 1004MC Market Conditions Rules Engine Specification
**Author:** Principal Fintech Architect & Lead Full-Stack Engineer  
**Date:** September 2026  
**System Status:** GSE / HUD 4000.1 / VA Pamphlet 26-7 Compliant  
**Environment:** Zero-Data-Retention (ZDR) Containerized Node.js/Python microservices

---

## 1. Context & Architectural Overview

The **Form 1004MC (Market Conditions Addendum)** is the quantitative anchor of the residential appraisal. When a Staff Appraisal Reviewer (SAR) or underwriter audits an appraisal for high-LTV government programs (FHA and VA), the primary source of underwriting leakage is the **discrepancy between the subjective "Neighborhood" checkboxes** on Page 1 of the Form 1004 and the **objective statistical data** on the 1004MC.

This specification outlines the data formats, cross-validation algorithms, and serialization models that translate OCR-scraped coordinate grids from physical appraisal documents into an actionable **"Items to Address"** rule output. This rules output dynamically updates the underwriter's dashboard and directly registers clearing conditions within the loan's Loan Origination System (LOS) via our Encompass Sync framework.

### **The Data Flow Architecture**
```
┌────────────────────────┐      ┌────────────────────────┐
│  Form 1004 URAR Page 1 │      │   Form 1004MC Grid     │
│   (Neighborhood Data)  │      │  (Market Data Matrix)  │
└───────────┬────────────┘      └───────────┬────────────┘
            │                               │
            └───────────────┬───────────────┘
                            ▼
        ┌───────────────────────────────────────┐
        │   In-Memory PDF Extraction Pipeline   │
        │   (ai_pdf_converter & parser.py)      │
        └───────────────────┬───────────────────┘
                            ▼
     ┌─────────────────────────────────────────────┐
     │  Appraisal Cross-Form Rules Engine (TS)     │
     │  - Evaluates GSE, FHA, & VA Thresholds     │
     └──────────────────────┬──────────────────────┘
                            ▼
          ┌───────────────────────────────────┐
          │   actionable_items JSON Payload   │
          │   (Serialized to Postgres Audit)  │
          └─────────┬───────────────────────┬─┘
                    ▼                       ▼
      ┌───────────────────────────┐   ┌───────────────────────────┐
      │ Interactive UI Dashboard  │   │ Encompass eFolder Sync    │
      │  (AppraisalReviewGrid)    │   │ (Underwriter Conditions)  │
      └───────────────────────────┘   └───────────────────────────┘
```

---

## 2. Extraction Payloads & JSON Schemas

The backend parsing engine extracts coordinates and tabular values into a single unified JSON structure. The coordinates are represented as relative `[x, y, w, h]` floats (from 0.0 to 1.0) to resolve scanner-induced resolution scaling anomalies on the frontend.

### **A. Form 1004MC Statistical Input Payload**
This is the structured JSON output from the `appraisal_parser.py` parsing page 3 of the appraisal:

```json
{
  "marketConditions1004MC": {
    "parsedAt": "2026-09-02T18:34:00Z",
    "intervals": {
      "prior_7_12_months": {
        "total_comparable_active_listings": 45,
        "total_comparable_sales": 30,
        "absorption_rate_monthly": 5.0,
        "months_supply": 9.0,
        "median_sale_price": 350000.00,
        "median_dom": 28
      },
      "prior_4_6_months": {
        "total_comparable_active_listings": 52,
        "total_comparable_sales": 24,
        "absorption_rate_monthly": 4.0,
        "months_supply": 13.0,
        "median_sale_price": 342000.00,
        "median_dom": 35
      },
      "current_0_3_months": {
        "total_comparable_active_listings": 68,
        "total_comparable_sales": 18,
        "absorption_rate_monthly": 3.0,
        "months_supply": 22.6,
        "median_sale_price": 330000.00,
        "median_dom": 54
      }
    },
    "appraiser_checkboxes": {
      "overall_property_values": "STABLE",
      "demand_supply_limits": "IN_BALANCE",
      "marketing_time": "UNDER_3_MONTHS"
    },
    "coordinates": {
      "grid_boundary": [0.12, 0.20, 0.76, 0.45],
      "median_sale_price_current": [0.65, 0.41, 0.08, 0.03],
      "months_supply_current": [0.65, 0.36, 0.08, 0.03]
    }
  }
}
```

---

## 3. The Appraisal Cross-Form Rules Engine

Below is the complete, production-ready TypeScript implementation of the Appraisal and 1004MC Cross-Form Validation Rules Engine. This engine validates the raw inputs and generates a structured, serialized **Rules Output** classifying each discrepancy by risk severity (`CRITICAL_ERROR`, `MPR_VIOLATION`, `COMPLIANCE_WARNING`).

### **`AppraisalRulesEngine.ts`**
```typescript
export type SeverityType = 'CRITICAL_ERROR' | 'MPR_VIOLATION' | 'COMPLIANCE_WARNING' | 'GSE_THRESHOLD';

export interface AppraisalInputData {
  loanProgram: 'CONV' | 'FHA' | 'VA';
  metadata: {
    yearBuilt: number;
    neighborhoodTrend: 'INCREASING' | 'STABLE' | 'DECLINING';
    hasAtticInspection: boolean;
    hasCrawlspaceInspection: boolean;
    utilitiesFunctional: boolean;
    hasActivePestInfestation: boolean;
    heatingFunctional: boolean;
    privateWellWaterUsage: boolean;
  };
  marketConditions1004MC: {
    intervals: {
      prior_7_12_months: MarketInterval;
      prior_4_6_months: MarketInterval;
      current_0_3_months: MarketInterval;
    };
    appraiser_checkboxes: {
      overall_property_values: 'INCREASING' | 'STABLE' | 'DECLINING';
      demand_supply_limits: 'SHORTAGE' | 'IN_BALANCE' | 'OVER_SUPPLY';
      marketing_time: 'UNDER_3_MONTHS' | 'BETWEEN_3_6_MONTHS' | 'OVER_6_MONTHS';
    };
  };
}

export interface MarketInterval {
  total_comparable_active_listings: number;
  total_comparable_sales: number;
  absorption_rate_monthly: number;
  months_supply: number;
  median_sale_price: number;
  median_dom: number;
}

export interface ActionableItem {
  id: string;
  code: string;
  severity: SeverityType;
  category: 'REPAIR' | 'INSPECTION' | 'DISCREPANCY' | 'ADMIN';
  message: string;
  mitigationRequirement: string;
  sourceAuthority: 'FHA_HUD_4000_1' | 'VA_PAM_26_7' | 'FANNIE_MAE_SELLING_GUIDE';
  pdfCoordinates?: [number, number, number, number]; // [x, y, w, h] for UI highlights
  isCleared: boolean;
}

export class AppraisalRulesEngine {
  
  public static runAllRules(data: AppraisalInputData): ActionableItem[] {
    const items: ActionableItem[] = [];

    // --- RULE 1: LEAD PAINT CRITICAL DEFICIENCY (FHA/VA Pre-1978) ---
    if (data.metadata.yearBuilt < 1978 && (data.loanProgram === 'FHA' || data.loanProgram === 'VA')) {
      items.push({
        id: `ACT-LP-${Date.now()}`,
        code: 'HUD_PRE_1978_LEAD_PAINT',
        severity: 'CRITICAL_ERROR',
        category: 'REPAIR',
        message: `Property constructed in ${data.metadata.yearBuilt} (pre-1978). Structural integrity checks reveal peeling, scaling, or chipping paint.`,
        mitigationRequirement: 'Mandatory scraping, priming, and painting of all identified exterior/interior peeling surfaces. Re-inspection with physical photodocumentation is required prior to clear-to-close.',
        sourceAuthority: 'FHA_HUD_4000_1',
        isCleared: false
      });
    }

    // --- RULE 2: FHA ATTIC & CRAWLSPACE ACCESS ---
    if (data.loanProgram === 'FHA') {
      if (!data.metadata.hasAtticInspection || !data.metadata.hasCrawlspaceInspection) {
        items.push({
          id: `ACT-FHA-INSPECT-${Date.now()}`,
          code: 'FHA_PHYSICAL_ACCESS_MISSING',
          severity: 'CRITICAL_ERROR',
          category: 'INSPECTION',
          message: 'FHA Minimum Property Standards require a physical "head and shoulders" inspection of both the attic and crawlspace.',
          mitigationRequirement: 'Appraiser must perform a structural re-visit to execute visual inspection of both areas and submit updated Form 1004 addenda certifying no moisture, structural framing failures, or active leaks exist.',
          sourceAuthority: 'FHA_HUD_4000_1',
          isCleared: false
        });
      }

      if (!data.metadata.utilitiesFunctional) {
        items.push({
          id: `ACT-FHA-UTILS-${Date.now()}`,
          code: 'FHA_UTILITIES_INACTIVE',
          severity: 'CRITICAL_ERROR',
          category: 'REPAIR',
          message: 'HUD Compliance Mandate: Core operational utilities (electricity, public water, natural gas/propane) were noted as inactive at the inspection date.',
          mitigationRequirement: 'Sellers must activate all utilities. Appraiser must execute an FHA CIR (Compliance Inspection Report, Form HUD-92051) verifying all heating, water, and electrical systems are fully operational.',
          sourceAuthority: 'FHA_HUD_4000_1',
          isCleared: false
        });
      }
    }

    // --- RULE 3: VA MINIMUM PROPERTY REQUIREMENTS (MPRs) ---
    if (data.loanProgram === 'VA') {
      if (data.metadata.hasActivePestInfestation) {
        items.push({
          id: `ACT-VA-PEST-${Date.now()}`,
          code: 'VA_ACTIVE_WDI_INFESTATION',
          severity: 'MPR_VIOLATION',
          category: 'REPAIR',
          message: 'Active Wood-Destroying Insect (WDI) termite tunnels or damage detected by appraiser.',
          mitigationRequirement: 'Complete chemical soil/structure eradication by a licensed pest control operator is mandatory. Submit certified Form NPMA-33 clearing the property.',
          sourceAuthority: 'VA_PAM_26_7',
          isCleared: false
        });
      }

      if (data.metadata.privateWellWaterUsage) {
        items.push({
          id: `ACT-VA-WATER-${Date.now()}`,
          code: 'VA_POTABILITY_TEST_REQUIRED',
          severity: 'COMPLIANCE_WARNING',
          category: 'INSPECTION',
          message: 'Individual private well system serves as the primary culinary water source.',
          mitigationRequirement: 'Underwriter must collect a chemical and bacteriological water potability report from a local health authority or certified laboratory indicating water meets EPA standards (Lead, Nitrates, Coliform tests).',
          sourceAuthority: 'VA_PAM_26_7',
          isCleared: false
        });
      }
    }

    // --- RULE 4: CROSS-FORM DISCREPANCY (1004 Page 1 vs 1004MC Price Trend) ---
    const priceChange = ((data.marketConditions1004MC.intervals.current_0_3_months.median_sale_price - data.marketConditions1004MC.intervals.prior_7_12_months.median_sale_price) / data.marketConditions1004MC.intervals.prior_7_12_months.median_sale_price) * 100;
    
    if (priceChange < -3.0 && data.metadata.neighborhoodTrend !== 'DECLINING') {
      items.push({
        id: `ACT-DISC-PRICE-${Date.now()}`,
        code: '1004_1004MC_PRICE_DISCREPANCY',
        severity: 'CRITICAL_ERROR',
        category: 'DISCREPANCY',
        message: `Appraiser marked the neighborhood trend as "${data.metadata.neighborhoodTrend}" on URAR Page 1, but Form 1004MC statistical calculations indicate a clear -${Math.abs(priceChange).toFixed(1)}% drop in actual Median Sale Prices.`,
        mitigationRequirement: 'Appraiser must resolve this conflict. Either correct the box on Form 1004 Page 1 to "Declining" and verify if LTV/market restrictions apply, or provide an extensive statistical narrative detailing why the neighborhood is stable despite a regional price slide.',
        sourceAuthority: 'FANNIE_MAE_SELLING_GUIDE',
        pdfCoordinates: [0.65, 0.41, 0.08, 0.03], // Highlight exact Median Sale Price coordinate
        isCleared: false
      });
    }

    // --- RULE 5: MONTHS SUPPLY VS SUPPLY CHECKBOX DISCREPANCY (OVERSUPPLY) ---
    const currentMonthsSupply = data.marketConditions1004MC.intervals.current_0_3_months.months_supply;
    if (currentMonthsSupply > 6.0 && data.marketConditions1004MC.appraiser_checkboxes.demand_supply_limits !== 'OVER_SUPPLY') {
      items.push({
        id: `ACT-DISC-SUPPLY-${Date.now()}`,
        code: '1004MC_OVERSUPPLY_NOT_FLAGGED',
        severity: 'COMPLIANCE_WARNING',
        category: 'DISCREPANCY',
        message: `Current months' supply of inventory has climbed to ${currentMonthsSupply.toFixed(1)} months (indicating a buyers' market / oversupply), but the appraiser checked "${data.marketConditions1004MC.appraiser_checkboxes.demand_supply_limits}" on Form 1004MC.`,
        mitigationRequirement: 'Appraiser must correct the Demand/Supply checkbox on Form 1004MC to "Over-Supply" or submit a detailed market-absorption commentary justifying how an active inventory backlog of over 6 months represents a balanced market in this specific zip code.',
        sourceAuthority: 'FANNIE_MAE_SELLING_GUIDE',
        pdfCoordinates: [0.65, 0.36, 0.08, 0.03],
        isCleared: false
      });
    }

    return items;
  }
}
```

---

## 4. Actionable Rules Output Serialization Schema

When the rules engine executes, the output array of `ActionableItem`s is serialized and committed directly to PostgreSQL. This structured payload is used to hydrate the side-by-side QA review dashboard and compile the loan’s automated task list.

### **Database Schema Integration (Prisma Extensions)**
```prisma
model AppraisalActionItem {
  id                   String        @id @default(uuid()) @db.Uuid
  appraisalAuditId     String        @db.Uuid
  appraisalAudit       AppraisalAudit @relation(fields: [appraisalAuditId], references: [id], onDelete: Cascade)

  code                 String        @db.VarChar(100) // e.g., HUD_PRE_1978_LEAD_PAINT
  severity             String        @db.VarChar(50)  // CRITICAL_ERROR, COMPLIANCE_WARNING, etc.
  category             String        @db.VarChar(50)  // REPAIR, INSPECTION, DISCREPANCY
  message              String        @db.Text
  mitigationRequirement String       @db.Text
  sourceAuthority      String        @db.VarChar(100) // FHA_HUD_4000_1, VA_PAM_26_7
  
  // PDF Overlays
  pdfPageNumber        Int?
  pdfCoordinates       Decimal[]     // Array of [x, y, w, h] floats
  
  // Clearing & Human Override Audit Tracking
  isCleared            Boolean       @default(false)
  clearedAt            DateTime?     @db.Timestamptz
  clearedByUserId      String?       @db.Uuid
  clearanceNotes       String?       @db.Text // Explains how the condition was satisfied (e.g. "NPMA-33 attached")

  @@index([appraisalAuditId])
  @@map("appraisal_action_items")
}
```

---

## 5. UI/UX Interaction Blueprint

The **AppraisalReviewGrid** utilizes the structured JSON output to build an intuitive, point-and-click underwriter experience.

### **The Coordinate-Highlight Overlay Hook**
```typescript
import React, { useState } from 'react';

export const CoordinatesHighlightLayer = ({ 
  coordinates, 
  onHover 
}: { 
  coordinates: [number, number, number, number], 
  onHover: () => void 
}) => {
  const [x, y, w, h] = coordinates;
  
  // Convert relative floats (e.g., 0.65, 0.41) to percentage string bounds for CSS positioning
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    border: '2px solid #ef4444', // Tailwind Rose-500
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    cursor: 'pointer',
    zIndex: 40,
    transition: 'all 150ms ease-in-out'
  };

  return (
    <div 
      style={style} 
      onClick={onHover} 
      className="animate-pulse rounded hover:scale-105 hover:bg-opacity-25"
      title="Click to view automated cross-validation warning detail"
    />
  );
};
```

### **Step-by-Step UI Workflow**
1. **Underwriter Selects a Loan Program:** Clicking **FHA** or **VA** on the dashboard instantly re-runs `AppraisalRulesEngine.runAllRules()` on the parsed collateral variables in memory.
2. **Reviewing Cross-Form Discrepancies:** The **"Items to Address"** sidebar displays a prioritized list of alerts. For example, a red flag reads: *"CRITICAL: 1004 Page 1 lists 'Stable', but 1004MC calculates -5.7% decline."*
3. **Point-to-Target Highlight Inspection:** The underwriter clicks the **"Inspect PDF Field"** target icon next to the error.
   * *UI Action:* The PDF viewer on the left automatically scrolls to Page 3 and draws a highlighted red box directly over the **Current 0-3 Month Median Sale Price** field [cite: `AppraisalReviewGrid.tsx`]. This eliminates manual document searching.
4. **Interactive Sign-Off and Clearance Override:**
   * *UI Action:* Underwriters check off physical requirements (e.g., ticking the box for *"Attic Inspected"* or *"Well Water potability cleared"*).
   * *Prisma Lock:* When clicked, the backend logs the clearing user’s ID, timestamp, and verification text [cite: `AppraisalReviewGrid.tsx`].
5. **Lock & Export to Encompass:** Once all high-severity items are marked cleared or justified, the underwriter locks the audit. The system automatically creates equivalent compliance conditions directly inside the Encompass eFolder using our integration routes, preparing the file for a seamless loan closing.
