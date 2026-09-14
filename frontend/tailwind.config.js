/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#101010',
        'on-primary': '#FFFFFF',
        secondary: '#DED8CD',
        'on-secondary': '#FFFFFF',
        accent: '#101010',
        'on-accent': '#FFFFFF',
        background: '#F2EFE8',
        foreground: '#101010',
        card: '#FAF8F3',
        'card-foreground': '#101010',
        muted: '#E5E0D7',
        'muted-foreground': '#5F5B54',
        border: '#BEB8AE',
        destructive: '#9B2318',
        'on-destructive': '#FFFFFF',
        ring: '#101010',
      },
      fontFamily: {
        sans: ['"HelveticaNowDisplayW01-Rg"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        serif: ['"HelveticaNowDisplay-Medium"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
