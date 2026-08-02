/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#16A34A",
          deep: "#15803D",
          mist: "#DCFCE7",
        },
        canvas: "#F7FAF8",
        ink: "#0F172A",
        risk: {
          low: "#16A34A",
          medium: "#F59E0B",
          high: "#DC2626",
        },
        navy: {
          DEFAULT: "#0b132b",
          light: "#1c2541",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)",
      },
    },
  },
  plugins: [],
}
