import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        blueprint: {
          950: "#050B16",
          900: "#0A1324",
          800: "#111E36",
          700: "#1D3258",
        },
      },
    },
  },
  plugins: [],
};

export default config;
