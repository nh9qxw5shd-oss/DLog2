/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        nr: {
          orange: '#E05206',
          blue: '#003366',
          navy: '#001F45',
          steel: '#4A6FA5',
          slate: '#2C3E50',
          amber: '#F39C12',
          red: '#C0392B',
          green: '#27AE60',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      }
    },
  },
  plugins: [],
}
