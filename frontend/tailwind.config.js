/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        court: {
          bg: "#0F4C3A",     // pickleball court green
          line: "#F5F1E8",   // court line chalk white
        },
        kitchen: "#1B6B4A",
        ball: "#F2C94C",     // pickleball yellow
        beginner: "#4C9AFF",
        average: "#F2994A",
        advance: "#EB5757",
      },
      fontFamily: {
        display: ["'Rajdhani'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
