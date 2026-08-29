/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: {
          850: '#151f32',
          950: '#070a13',
        },
        emerald: {
          400: '#34d399',
          500: '#10b981',
        },
      },
      backgroundImage: {
        'radial-hero':
          'radial-gradient(ellipse 80% 80% at 50% -20%, rgba(16,185,129,0.08), rgba(255,255,255,0))',
      },
      boxShadow: {
        'glow-emerald': '0 0 15px -3px rgba(16, 185, 129, 0.1)',
      },
    },
  },
  plugins: [],
};
