# Monorepo UI Integration Guide: Shared PDF Coordinate Canvas (v1)
*Standardized Spatial Highlight Coordination for AI Income & Appraisal Review Workspaces*

---

## 1. Overview & Architectural Goal

To enforce strict visual traceability and eliminate black-box AI liability, both the **AI Income Verification Dashboard** (`UnderwriterSplitViewDemo.tsx`) and the **Collateral Appraisal Review Agent** (`AppraisalReviewGrid.tsx`) leverage a shared visual layout. 

This guide outlines how to integrate our highly optimized, shared React component and hook:
1.  **`usePdfViewer`** (packages/ui/src/hooks/usePdfViewer.ts) — Manages viewport transformations, percentage-based coordinate mapping, dynamic zooming, and auto-scrolling events.
2.  **`PdfCoordinateCanvas`** (packages/ui/src/components/PdfCoordinateCanvas.tsx) — Renders the document viewport (underlying paystub/W-2 or 1004 Appraisal PDF) and overlays active bounding boxes `[x, y, w, h]` dynamically in real-time.

By centralizing this visualization layer, we maintain perfect UI/UX symmetry across both point solutions, improve render performance, and keep the code modular inside our **Turborepo monorepo**.

---

## 2. Directory Structure Setup

Ensure both shared workspace assets have been migrated using `copy-assets-v20.sh` into your shared UI package:

```
packages/ui/
├── src/
│   ├── components/
│   │   └── PdfCoordinateCanvas.tsx   # <-- Shared Overlay Canvas
│   └── hooks/
│       └── usePdfViewer.ts           # <-- Coordinate Coordinate Controller
```

---

## 3. Step 1: Integrating into `UnderwriterSplitViewDemo-v11.tsx` (AI Income Tool)

Follow these steps to replace the duplicated left-hand pane code inside your main Income Underwriting dashboard:

### A. Add Imports & Initialize Hook
Open `UnderwriterSplitViewDemo-v11.tsx` and replace any local canvas refs or local coordinate hooks with our unified component:

```tsx
import React, { useState } from 'react';
import { PdfCoordinateCanvas } from '@freeflow/ui/components/PdfCoordinateCanvas';
import { usePdfViewer } from '@freeflow/ui/hooks/usePdfViewer';

// Optional: Define mock coordinate mappings for incoming OCR paystub variables
const paystubCoordinateMap: Record<string, { pageIndex: number; box: [number, number, number, number] }> = {
  'ps-hourly-rate': { pageIndex: 0, box: [10, 20, 40, 3] },
  'ps-current-base': { pageIndex: 0, box: [10, 22, 40, 3] },
  'ps-base-ytd': { pageIndex: 0, box: [10, 25, 40, 3] },
  'ps-bonus-ytd': { pageIndex: 0, box: [50, 25, 40, 3] },
  'ps-ot-ytd': { pageIndex: 0, box: [10, 28, 40, 3] },
  'ps-emp-name': { pageIndex: 0, box: [10, 5, 40, 3] },
  'ps-period': { pageIndex: 0, box: [10, 15, 40, 3] },
};
```

### B. Instantiate the Viewer Controller
Initialize the hook inside your main React component. This manages synchronized zoom scales and centering commands:

```tsx
export function UnderwriterSplitViewDemo() {
  const [documentUrl, setDocumentUrl] = useState<string>('/mock/apex_stub_august.pdf');
  
  // Connect the unified PDF viewport hook
  const {
    activeHighlight,
    zoomScale,
    setZoomScale,
    handleInspectField,
    clearHighlight,
    canvasRef
  } = usePdfViewer();

  // Helper to link paystub sidebar fields to coordinates
  const triggerInspect = (fieldId: string) => {
    const coord = paystubCoordinateMap[fieldId];
    if (coord) {
      handleInspectField(coord.pageIndex, coord.box);
    }
  };
```

### C. Update Render Layout (Left Pane Replacement)
Replace your custom PDF viewer wrapper in the JSX layout with the shared canvas component:

```tsx
  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden text-slate-100">
      {/* LEFT PANE: Standardized Visual Coordinate Canvas */}
      <div className="w-1/2 h-full border-r border-slate-800 flex flex-col bg-slate-900">
        <PdfCoordinateCanvas
          documentUrl={documentUrl}
          activeHighlight={activeHighlight}
          zoomScale={zoomScale}
          onZoomChange={setZoomScale}
          onClearHighlight={clearHighlight}
          canvasRef={canvasRef}
          documentType="PAYSTUB"
        />
      </div>

      {/* RIGHT PANE: Tabs, Overrides, and Calculators */}
      <div className="w-1/2 h-full flex flex-col overflow-y-auto bg-slate-950">
         {/* Sidebar layout goes here. Pass triggerInspect(field.id) to your custom inspect buttons */}
      </div>
    </div>
  );
}
```

---

## 4. Step 2: Integrating into `AppraisalReviewGrid-v3.tsx` (Appraisal Review Agent)

Follow these steps to wire up the collateral review panel. It displays a standard URAR 1004 form and highlights structural flaws (e.g., chipped paint, damaged crawlspace) or valuation adjustments:

### A. Define Appraisal Spatial Markers
Add imports and specify the spatial mappings pointing to standard FHA/VA 1004 form pages:

```tsx
import React, { useState } from 'react';
import { PdfCoordinateCanvas } from '@freeflow/ui/components/PdfCoordinateCanvas';
import { usePdfViewer } from '@freeflow/ui/hooks/usePdfViewer';

const appraisalCoordinateMap: Record<string, { pageIndex: number; box: [number, number, number, number] }> = {
  'URAR_SUBJECT_CONTRACT': { pageIndex: 0, box: [12, 18, 76, 5] },
  'URAR_NEIGHBORHOOD_TRENDS': { pageIndex: 0, box: [12, 35, 76, 8] },
  'URAR_PHYSICAL_REPAIRS': { pageIndex: 1, box: [12, 55, 76, 6] },
  'URAR_COMP_1_ADJUSTMENT': { pageIndex: 1, box: [35, 22, 15, 4] },
  'URAR_CRAWLSPACE_ACC_VIOLATION': { pageIndex: 2, box: [15, 60, 70, 5] },
};
```

### B. Integrate Hook and Multi-Page Swapping
Initialize the coordinate controllers inside the appraisal reviewer component. This handles multi-page document scrolling:

```tsx
export function AppraisalReviewGrid() {
  const [appraisalUrl, setAppraisalUrl] = useState<string>('/mock/urar_1004_casefile.pdf');

  const {
    activeHighlight,
    zoomScale,
    setZoomScale,
    handleInspectField,
    clearHighlight,
    canvasRef
  } = usePdfViewer();

  const inspectAppraisalIssue = (issueCode: string) => {
    const marker = appraisalCoordinateMap[issueCode];
    if (marker) {
      handleInspectField(marker.pageIndex, marker.box);
    }
  };
```

### C. Update Render Layout (Symmetric Two-Pane Division)
Construct the exact same visual boundary inside the appraisal workspace:

```tsx
  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden text-slate-100">
      {/* LEFT PANE: Shared Canvas rendering URAR Template overlays */}
      <div className="w-1/2 h-full border-r border-slate-800 flex flex-col bg-slate-900">
        <PdfCoordinateCanvas
          documentUrl={appraisalUrl}
          activeHighlight={activeHighlight}
          zoomScale={zoomScale}
          onZoomChange={setZoomScale}
          onClearHighlight={clearHighlight}
          canvasRef={canvasRef}
          documentType="URAR"
        />
      </div>

      {/* RIGHT PANE: Compliance checklist, Comps Grid adjustments & Notice of Value condition pre-fills */}
      <div className="w-1/2 h-full flex flex-col overflow-y-auto bg-slate-950 p-6">
         {/* When list items render, trigger inspectAppraisalIssue('URAR_CRAWLSPACE_ACC_VIOLATION') on click */}
      </div>
    </div>
  );
}
```

---

## 5. Performance & Customization Auditing

Symmetry across both portals guarantees optimization and maintainability:
*   **Virtual Scroll Contexts:** Because `PdfCoordinateCanvas` supports virtualized pages, heavy multi-page 100-page appraisal documentation will load without crashing local client browser threads.
*   **Responsive Rescaling:** Both layouts use percentage-based floats rather than absolute pixel coordinates, keeping highlight squares locked over correct fields whether a user scales on standard 1080p monitors or ultra-wide screens.
