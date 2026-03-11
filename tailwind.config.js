/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./frontend/index.html', './frontend/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          light: '#f8fafc',
          dark: '#020617',
        },
      },
      boxShadow: {
        premium: '0 20px 50px rgba(15,23,42,0.25)',
      },
    },
  },
  plugins: [],
};
