/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FEFCF8',
          100: '#FDF8EE',
          200: '#F9EDDA',
        },
        forest: {
          500: '#2D5A3D',
          600: '#1E4D2B',
          700: '#153D20',
          800: '#0D2E16',
        },
        warmth: {
          400: '#E8935A',
          500: '#D97B3D',
          600: '#C4682E',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
