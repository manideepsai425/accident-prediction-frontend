/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#16A34A",
          deep: "#0F5132",
          mist: "#D9F2E3",
        },
        canvas: "#F6F1E4",
        ink: "#12271E",
        risk: {
          low: "#16A34A",
          medium: "#F59E0B",
          high: "#DC2626",
        },
        navy: {
          DEFAULT: "#0F3D2E",
          light: "#145C41",
        },
        gold: {
          DEFAULT: "#D97706",
          deep: "#92400E",
          mist: "#FEF3C7",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 1px rgba(18,39,30,0.03), 0 2px 6px rgba(18,39,30,0.05), 0 12px 24px -8px rgba(18,39,30,0.10)",
        raised: "0 1px 1px rgba(18,39,30,0.04), 0 4px 10px rgba(18,39,30,0.06), 0 20px 32px -12px rgba(18,39,30,0.14)",
        pressed: "0 1px 1px rgba(18,39,30,0.05) inset, 0 1px 2px rgba(18,39,30,0.06)",
        glass: "0 8px 30px rgba(18,39,30,0.10)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
}
