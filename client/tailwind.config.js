/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        harbor: {
          deep: "#0F1B2D",   // header / launcher — deep night-water navy
          slate: "#1B2A41",  // panel background
          mist: "#F4F6F8",   // visitor bubble / body background
          beam: "#F5A623",   // amber accent — the "lighthouse beam"
          tide: "#2D7D8C",   // agent bubble
          ok: "#34C77B",     // online indicator
        },
        wa: {
          header: "#075E54",   // dark teal-green app bar
          panel: "#128C7E",    // secondary teal
          bg: "#ECE5DD",       // chat wallpaper base tone
          own: "#D9FDD3",      // own message bubble (light green)
          other: "#FFFFFF",    // other participants' bubble
          accent: "#25D366",   // brand green (launcher/send button)
          ink: "#111B21",      // primary text
          sub: "#667781",      // secondary/meta text
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
      },
      keyframes: {
        beam: {
          "0%, 100%": { opacity: 0.35, transform: "scaleX(0.9)" },
          "50%": { opacity: 1, transform: "scaleX(1.05)" },
        },
        pop: {
          "0%": { transform: "scale(0.85)", opacity: 0 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
      },
      animation: {
        beam: "beam 1.6s ease-in-out infinite",
        pop: "pop 0.18s ease-out",
      },
    },
  },
  plugins: [],
};
