import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fundo: '#0e1528',
        cartao: '#151e33',
        cartao2: '#1a2440',
        borda: '#222d47',
        texto: '#e6ebf5',
        suave: '#8a96b0',
        destaque: '#1f6feb',
        destaqueHover: '#2f7cf5',
        verde: '#22c55e',
        vermelho: '#ef4444',
        amarelo: '#eab308',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
