import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        vynora: {
          900: "#171717", // Neutral-900 like saasinterface
          800: "#262626", // Neutral-800
          primary: "#38bdf8", // Sky-400
          success: "#10b981", 
          warning: "#f59e0b", 
          danger: "#ef4444", 
        }
      },
      keyframes: {
        "bg-move": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "bg-move": "bg-move 3s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
