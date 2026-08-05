import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        foreground: "var(--fg)",
        muted: "var(--muted)",
        border: "var(--border)",
        accent: {
          DEFAULT: "var(--orange)",
          hover: "var(--orange-hover)",
        },
        highlight: {
          DEFAULT: "var(--yellow)",
          muted: "var(--yellow-muted)",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "sans-serif"],
        heading: ["system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
