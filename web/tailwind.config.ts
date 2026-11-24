import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        // Phones held sideways (see PHONE_MAX_HEIGHT in PlayTouchControls).
        short: { raw: "(max-height: 520px)" },
      },
      colors: {
        parchment: "#f6efd6",
        ink: "#1a1a2e",
        ember: "#c8553d",
      },
      fontFamily: {
        display: ["ui-serif", "Georgia", "Cambria", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
