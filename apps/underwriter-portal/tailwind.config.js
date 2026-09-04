/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Deep premium dark mode baseline layers
        slate: {
          850: '#151f32', // Used for premium card containers to prevent "pure black" flat look
          950: '#070a13', // Absolute canvas baseline (glowing radial gradient backdrop)
        },
        // Precision emerald/teal action & compliance indicators
        emerald: {
          400: '#34d399', // Status alerts, auto-aligned labels, active metrics
          500: '#10b981', // Prime CTA buttons, success icons, high-confidence scores
        },
        teal: {
          400: '#2dd4bf', // Accent gradients, secondary visual highlights
        },
        rose: {
          500: '#f43f5e', // Lockout notifications, critical mismatch indicators, unpaid ledger alerts
        },
      },
      fontFamily: {
        // High-legibility professional type scale matched to our PDF-generation system
        sans: ['Roboto', 'Liberation Sans', 'sans-serif'],
        mono: ['Noto Sans Mono', 'Liberation Mono', 'monospace'],
      },
      boxShadow: {
        // Emerald active-glow container highlights (used on the most popular pricing tier & selected records)
        'glow-emerald': '0 0 20px -5px rgba(16, 185, 129, 0.15)',
        'glow-rose': '0 0 20px -5px rgba(244, 63, 94, 0.15)',
      },
      backgroundImage: {
        // Glowing background radial gradients for modern, high-conversion landing pages
        'radial-hero': 'radial-gradient(ellipse 80% 80% at 50% -20%, rgba(16, 185, 129, 0.08), rgba(255, 255, 255, 0))',
      },
      borderWidth: {
        '0.5': '0.5px', // Ultra-thin borders for a sleek modern UI layout
      },
    },
  },
  plugins: [],
}
