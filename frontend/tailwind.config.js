/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Primary accent — indigo
        primary: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        // Surface tokens — zinc-based (warmer, more premium than gray)
        surface: {
          0:   '#09090b',   // page bg
          1:   '#0f0f12',   // card bg
          2:   '#18181b',   // elevated
          3:   '#1f1f23',   // hover
          4:   '#27272a',   // active / selected
        },
        border: {
          1: 'rgba(255,255,255,0.06)',
          2: 'rgba(255,255,255,0.09)',
          3: 'rgba(255,255,255,0.12)',
        },
        // Cyberpunk neon colors
        neon: {
          cyan:     '#00f0ff',
          magenta:  '#ff00ff',
          purple:   '#9d00ff',
          pink:     '#ff0080',
          green:    '#00ff00',
          yellow:   '#ffff00',
          blue:     '#0080ff',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'noise': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E\")",
      },
      boxShadow: {
        'glow':    '0 0 24px rgba(99,102,241,0.18)',
        'glow-sm': '0 0 12px rgba(99,102,241,0.12)',
        'card':    '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.08)',
        'inset-t': 'inset 0 1px 0 rgba(0,0,0,0.03)',
        // Neon glow effects
        'neon-cyan':    '0 0 10px rgba(0,240,255,0.5), 0 0 20px rgba(0,240,255,0.3)',
        'neon-magenta': '0 0 10px rgba(255,0,255,0.5), 0 0 20px rgba(255,0,255,0.3)',
        'neon-purple':  '0 0 10px rgba(157,0,255,0.5), 0 0 20px rgba(157,0,255,0.3)',
        'neon-pink':    '0 0 10px rgba(255,0,128,0.5), 0 0 20px rgba(255,0,128,0.3)',
        'glow-xl':      '0 0 30px rgba(99,102,241,0.25), 0 0 60px rgba(99,102,241,0.15)',
        'glass':        '0 8px 32px 0 rgba(31,38,135,0.37)',
      },
      animation: {
        'fade-in':    'fadeIn 0.25s ease-out',
        'slide-up':   'slideUp 0.25s cubic-bezier(0.16,1,0.3,1)',
        'slide-in':   'slideIn 0.2s cubic-bezier(0.16,1,0.3,1)',
        'scale-in':   'scaleIn 0.2s cubic-bezier(0.16,1,0.3,1)',
        'shimmer':    'shimmer 2s linear infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4,0,0.6,1) infinite',
        'float':      'float 6s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'neon-glow':  'neonGlow 1.5s ease-in-out infinite',
        'glitch':     'glitch 0.4s ease-in-out',
        'text-reveal': 'textReveal 0.8s ease-out',
        'typing':     'typing 0.1s steps(1, end)',
        'blink':      'blink 1s step-end infinite',
        'aurora':     'aurora 8s ease-in-out infinite',
        'particle-float': 'particleFloat 6s ease-in-out infinite',
        'rotate-slow': 'spin 20s linear infinite',
        'bounce-slow': 'bounceSlow 2s ease-in-out infinite',
        'lift':       'lift 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        scaleIn: { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        float:   {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        glowPulse: {
          '0%, 100%': { filter: 'drop-shadow(0 0 5px rgba(99,102,241,0.4))' },
          '50%':      { filter: 'drop-shadow(0 0 20px rgba(99,102,241,0.8))' },
        },
        neonGlow: {
          '0%, 100%': { textShadow: '0 0 10px currentColor, 0 0 20px currentColor' },
          '50%':      { textShadow: '0 0 5px currentColor, 0 0 10px currentColor' },
        },
        glitch: {
          '0%':   { transform: 'translate(0)' },
          '20%':  { transform: 'translate(-2px, 2px)' },
          '40%':  { transform: 'translate(-2px, -2px)' },
          '60%':  { transform: 'translate(2px, 2px)' },
          '80%':  { transform: 'translate(2px, -2px)' },
          '100%': { transform: 'translate(0)' },
        },
        textReveal: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        typing: {
          from: { width: '0' },
          to:   { width: '100%' },
        },
        blink: {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
        aurora: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%':      { backgroundPosition: '100% 50%' },
        },
        particleFloat: {
          '0%, 100%': { transform: 'translateY(0) translateX(0)', opacity: '1' },
          '50%':      { transform: 'translateY(-40px) translateX(20px)', opacity: '0.6' },
        },
        bounceSlow: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        lift: {
          from: { transform: 'translateY(0)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' },
          to:   { transform: 'translateY(-8px)', boxShadow: '0 12px 24px rgba(0,0,0,0.2)' },
        },
      },
    },
  },
  plugins: [],
}
