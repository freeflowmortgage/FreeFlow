# @mortgage-pos/ui — Standard UI & Underwriting Design System

This package houses the shared design tokens, component abstractions, Tailwind configuration hooks, and responsive viewports for the **FreeFlow Standalone Income Engine** Point of Sale (POS) and Loan Officer/Underwriter dashboards.

---

## 1. Package Directory Architecture

This workspace is a core shared package within our Turborepo monorepo:

```text
packages/ui/
├── README.md                      # This developer orientation file
├── package.json                   # Local workspace setup & peer dependencies
├── tsconfig.json                  # TypeScript compiler settings for shared exports
└── src/
    ├── theme/
    │   └── tailwind-theme-overrides.js # Core visual tokens (Slate-950, Emerald accents)
    ├── components/
    │   ├── UnderwriterSplitViewDemoV2.tsx # High-contrast side-by-side QA review dashboard
    │   ├── PricingPageDemo.tsx            # Live responsive landing page with ROI calculator
    │   └── ui/
    │       ├── card.tsx                   # Sub-grid card wrappers for layout blocks
    │       └── slider.tsx                 # Configurable touch-targets for slider values
    └── index.ts                   # Export declarations for monorepo imports
```

---

## 2. Shared Monorepo Setup & Wiring

To link this package with your apps (such as `apps/web` or `apps/landing`), map the workspace import path directly in your application configurations.

### A. UI Package Configuration (`packages/ui/package.json`)
```json
{
  "name": "@mortgage-pos/ui",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "peerDependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "lucide-react": "^0.378.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "tailwindcss": "^3.4.0"
  }
}
```

### B. Consuming App Configuration (`apps/web/package.json`)
Declare the workspace link inside your frontend packages to resolve dependencies via Turborepo:
```json
{
  "name": "web",
  "dependencies": {
    "@mortgage-pos/ui": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "lucide-react": "^0.378.0"
  }
}
```

---

## 3. Registering the Custom Tailwind Design System

To lock in our dark-mode Obsidian UI layout, extend the default Tailwind compiler theme using the shared overrides file.

### A. Override Specifications (`src/theme/tailwind-theme-overrides.js`)
```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        slate: {
          850: '#151f32', // Card background elements
          950: '#070a13', // Primary deep obsidian canvas
        },
        emerald: {
          400: '#34d399', // Action text, labels, and success glow
          500: '#10b981', // Solid UI elements & buttons
        }
      },
      backgroundImage: {
        'radial-hero': 'radial-gradient(ellipse 80% 80% at 50% -20%, rgba(16,185,129,0.08), rgba(255,255,255,0))',
      },
      boxShadow: {
        'glow-emerald': '0 0 15px -3px rgba(16, 185, 129, 0.1)',
      },
      borderWidth: {
        '0.5': '0.5px', // Ultra-thin hairline dividers
      }
    }
  }
};
```

### B. Consuming App Config (`apps/web/tailwind.config.js`)
Require the shared configuration path directly in your application build pipeline:
```javascript
const sharedTheme = require('@mortgage-pos/ui/src/theme/tailwind-theme-overrides');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}" // Crucial: Scan shared package
  ],
  darkMode: 'class',
  theme: sharedTheme.theme,
  plugins: [],
};
```

---

## 4. Component Wiring & Layout Protocols

### A. Pricing Page & ROI Calculator Layout (`PricingPageDemo.tsx`)
*   **The Logic:** Dynamically calculates current manual underwriter loaded cost vs. our transaction-based structure on every state change.
*   **Mobile Adaptability:** Cards collapse into a vertical column using responsive Tailwind grids (`grid grid-cols-1 lg:grid-cols-12`). Ranges include thick custom touch targets specifically scaled for thumbs on standard mobile viewports.
*   **Suggester Sub-tier Engine:**
    ```typescript
    const getFreeFlowCost = (files: number) => {
      const tier1Cost = files * 8; // $8.00 Standard
      const tier2Cost = 199 + (files * 25); // $25.00 Single-Proprietor
      const tier3Cost = 1499 + (files * 45); // $45.00 Multi-Entity
      // Select minimal pricing output dynamically
    }
    ```

### B. Underwriter Split-Screen QA Portal (`UnderwriterSplitViewDemoV2.tsx`)
*   **Relative OCR Highlighting:** To render precise coordinate boxes over PDF documents responsively, do not use static pixel offsets. Use percentage coordinates mapped onto an HTML5 canvas container:
    ```tsx
    <div 
      style={{
        position: 'absolute',
        top: `${coords.y}%`,
        left: `${coords.x}%`,
        width: `${coords.width}%`,
        height: `${coords.height}%`
      }}
      className="border-2 border-emerald-500 bg-emerald-500/10 pointer-events-none animate-pulse"
    />
    ```
*   **String Matching Threshold Verification:** Before updating loan fields in Encompass, run a Levenshtein-distance algorithm on borrower names. If similarity score `< 95%`, block automated sync, display an amber badge, and trigger a manual underwriter confirmation selector.

---

## 5. Dedicated Infrastructure & High-Performance Hosting Specs

Because our **Zero-Data-Retention (ZDR)** compliance policy forces us to pre-split, decrypt, and parse massive tax documentation packages **strictly inside container RAM** (never writing files to permanent disk storage to completely bypass 6-month bank security vetting):

*   **Production Hosting Target:** AWS ECS (Elastic Container Service) on AWS Fargate or Google Cloud Run.
*   **Configured Provisioning (Per Task Container):**
    *   **VCPU Allocation:** **Minimum 2.0 vCPU** (safeguards high-speed multi-threaded parsing and SHA-256 file signature encryption).
    *   **RAM Allocation:** **Minimum 4.0 GB Memory** (ensures your in-memory python-pdf pre-slicer can unzip, slice, and stream 150-page tax packages concurrently without hitting page swap limits or Out-Of-Memory crashes).
*   **Task Autoscaling Metrics:** Define scaling policies to spawn additional container nodes the millisecond memory utilization triggers **70%** for more than 120 seconds.

---

## 6. Verification & Local Development

To run the local sandbox environment and verify hot-reloading configurations:

```bash
# Link dependencies and register shared symlinks
pnpm install

# Run workspace dev servers concurrently 
pnpm dev
```

Navigate to `http://localhost:3000` to interact with the responsive layouts, test local calculation rules, and confirm layout styling rendering accuracy.
