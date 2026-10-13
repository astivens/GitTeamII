/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Linear-inspired neutral palette (dark first)
        bg: {
          DEFAULT: "#0a0a0b",
          subtle: "#131316",
          elevated: "#1c1c21",
          hover: "#25252b",
        },
        border: {
          DEFAULT: "#2a2a31",
          strong: "#3a3a44",
        },
        fg: {
          DEFAULT: "#e8e8ec",
          muted: "#9b9ba6",
          subtle: "#6b6b75",
        },
        accent: {
          DEFAULT: "#7c5cff",
          hover: "#9277ff",
        },
        status: {
          backlog: "#6b6b75",
          "in-progress": "#f59e0b",
          review: "#3b82f6",
          done: "#10b981",
          archived: "#4b4b54",
        },
        priority: {
          low: "#6b6b75",
          medium: "#3b82f6",
          high: "#f97316",
          urgent: "#ef4444",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.125rem" }],
        base: ["0.875rem", { lineHeight: "1.25rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.04)",
        elevated: "0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)",
      },
    },
  },
  plugins: [],
};
