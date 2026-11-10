/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#08080a', 900: '#0b0b0d', 850: '#111114', 800: '#16161a', 700: '#1e1e23', 600: '#2a2a31', 500: '#3a3a43', 400: '#6b6b76', 300: '#9a9aa5', 200: '#c9c9d1', 100: '#ececf1' },
        gold: { 300: '#f3d98b', 400: '#e8c25a', 500: '#d4a72c', 600: '#a8831f' },
        up: '#22b07d', down: '#e5484d',
      },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
