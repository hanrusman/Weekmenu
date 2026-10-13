const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

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
        // Theme-aware tokens: the channels live in index.css (light and .dark)
        canvas: token('canvas'),
        surface: token('surface'),
        sunken: token('sunken'),
        raised: token('raised'),
        line: { DEFAULT: token('line'), soft: token('line-soft') },
        ink: token('ink'),
        muted: token('muted'),
        faint: token('faint'),
        accent: token('accent'),
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        warn: { DEFAULT: token('warn'), soft: token('warn-soft') },
        brand: { DEFAULT: token('brand'), hover: token('brand-hover') },
        'on-brand': token('on-brand'),
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
