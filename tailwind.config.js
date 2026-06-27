/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          bg: '#ffffff',
          text: '#0a0a0a',
        },
        ink: {
          50: '#f7f6f3',
          100: '#ecebe6',
          200: '#d8d6cd',
          300: '#a9a69a',
          400: '#6d6a60',
          500: '#3f3d37',
          600: '#26241f',
          900: '#0a0a0a',
        },
        accent: {
          blue: '#4d6198',
          lightblue: '#a4aec9',
          red: '#cf2e2e',
          orange: '#ff6900',
          grey: '#32373c',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        display: ['Fraunces', 'ui-serif', 'Georgia', 'Cambria', 'Times', 'serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.4' }],
        sm: ['14px', { lineHeight: '1.5' }],
        base: ['16px', { lineHeight: '1.7' }],
        lg: ['19px', { lineHeight: '1.6' }],
        xl: ['24px', { lineHeight: '1.35' }],
        '2xl': ['32px', { lineHeight: '1.2' }],
        '3xl': ['48px', { lineHeight: '1.1' }],
        '4xl': ['64px', { lineHeight: '1.05' }],
        '5xl': ['80px', { lineHeight: '1' }],
        '6xl': ['112px', { lineHeight: '0.95' }],
      },
      lineHeight: {
        body: '1.7',
        heading: '1.1',
      },
      letterSpacing: {
        eyebrow: '0.32em',
        display: '-0.02em',
      },
      spacing: {
        section: 'clamp(2rem, 6vw, 6rem)',
        'gutter-mobile': '6vw',
        'gutter-desktop': '4vw',
      },
      maxWidth: {
        site: '2400px',
        prose: '72ch',
      },
      screens: {
        tablet: '737px',
        desktop: '1025px',
      },
      gridTemplateColumns: {
        mobile: 'repeat(8, 1fr)',
        desktop: 'repeat(24, 1fr)',
      },
      transitionTimingFunction: {
        editorial: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
