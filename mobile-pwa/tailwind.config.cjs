/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'scan-line': {
          '0%, 100%': { top: '4%' },
          '50%': { top: '96%' },
        },
      },
      animation: {
        'scan-line': 'scan-line 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
