/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FDFBF7',
          100: '#FDF8EE',
          200: '#F9EDDA',
        },
        forest: {
          500: '#2D5A3D',
          600: '#1E4D2B',
          700: '#153D20',
        },
        warmth: {
          400: '#F5D9C1',
          500: '#F2994A',
          600: '#E67E22',
        },
        muted: '#8E9299',
        ink: '#1A2B3D',
        accent: '#C2A482',
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1.5rem',
        '3xl': '2rem',
        '4xl': '2.5rem',
      },
    },
  },
  plugins: [],
};
