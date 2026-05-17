/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        tram: {
          A: '#EE3333',
          B: '#0066CC',
          C: '#00AA44',
          D: '#FF8800',
          E: '#9933CC',
        },
      },
    },
  },
  plugins: [],
}
