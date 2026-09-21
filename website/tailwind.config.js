/** @type {import('tailwindcss').Config} */
// Radius rule for the whole site: interactive controls are pills, cards and
// panels are 20px (rounded-card), inputs and small chips are 12px (rounded-field).
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Button variants are composed as btn--${variant}, which the scanner cannot see.
  safelist: [{ pattern: /^btn--(primary|glass|mint|sm|lg)$/ }],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#04060a',
          900: '#070a10',
          800: '#0b0f16',
          700: '#10151e',
          600: '#171d28',
          500: '#222a37',
        },
        line: {
          DEFAULT: 'rgba(255,255,255,0.09)',
          soft: 'rgba(255,255,255,0.06)',
          strong: 'rgba(255,255,255,0.16)',
        },
        fg: {
          DEFAULT: '#f4f6fa',
          soft: '#c9d0da',
          muted: '#98a2b0',
          dim: '#6c7684',
        },
        brand: {
          blue: '#2f7bff',
          sky: '#6aa6ff',
          mint: '#3fd0b5',
          violet: '#9b7bff',
          amber: '#f5b942',
          red: '#ff5f5f',
          green: '#32d583',
        },
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
        term: ['"JetBrains Mono Variable"', '"Geist Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      borderRadius: {
        card: '20px',
        field: '12px',
      },
      maxWidth: {
        page: '1240px',
      },
      keyframes: {
        'marquee': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        'pulse-ring': { '0%': { transform: 'scale(.8)', opacity: '.7' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        'shine': { from: { transform: 'translateX(-120%) skewX(-18deg)' }, to: { transform: 'translateX(220%) skewX(-18deg)' } },
        'caret': { '0%,49%': { opacity: '1' }, '50%,100%': { opacity: '0' } },
      },
      animation: {
        marquee: 'marquee 38s linear infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(.2,.7,.3,1) infinite',
        shine: 'shine 1.1s cubic-bezier(.2,.7,.3,1)',
        caret: 'caret 1.05s steps(1) infinite',
      },
    },
  },
  plugins: [],
};
