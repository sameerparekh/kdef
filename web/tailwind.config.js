/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Celebration animations (src/components/Celebration.tsx). All finish inside CELEBRATION_MS.
      keyframes: {
        confetti: {
          '0%': { transform: 'translateY(-1.5rem) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(100vh) rotate(540deg)', opacity: '0.9' },
        },
        rainbow: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        unicorn: {
          '0%': { transform: 'translateX(-20vw)' },
          '100%': { transform: 'translateX(110vw)' },
        },
        'star-pop': {
          '0%': { transform: 'translate(0, 0) scale(0.2)', opacity: '0' },
          '20%': { opacity: '1' },
          '100%': {
            transform: 'translate(var(--dx), var(--dy)) scale(1.2) rotate(200deg)',
            opacity: '0',
          },
        },
      },
      animation: {
        confetti: 'confetti 1800ms ease-in both',
        rainbow: 'rainbow 2200ms ease-in-out both',
        unicorn: 'unicorn 2200ms ease-in-out both',
        'star-pop': 'star-pop 1400ms ease-out both',
      },
    },
  },
  plugins: [],
};
