import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      fontFamily: {
        heebo: ["var(--font-heebo)", "system-ui", "sans-serif"],
        manrope: ["var(--font-manrope)", "system-ui", "sans-serif"],
        sans: ["var(--font-active)", "system-ui", "sans-serif"],
      },
      colors: {
        bg: { DEFAULT: "#FAFCFF", soft: "#F6FBFF", white: "#FFFFFF" },
        cyan: {
          soft: "#7DD3FC",
          DEFAULT: "#0EA5E9",
          bright: "#38BDF8",
          deep: "#0369A1",
        },
        pink: {
          soft: "#FDA4AF",
          bg: "#FFF1F5",
          deep: "#FB7185",
          rose: "#BE123C",
        },
        ink: { DEFAULT: "#101828", muted: "#344054" },
        muted: { DEFAULT: "#667085", foreground: "#667085" },
        line: { DEFAULT: "#E6EEF7", soft: "#EEF4FB" },
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
      },
      borderRadius: {
        card: "32px",
        "card-lg": "36px",
        md2: "20px",
        sm2: "14px",
      },
      boxShadow: {
        card: "0 24px 70px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
        soft: "0 12px 36px rgba(15, 23, 42, 0.06)",
        cyan: "0 20px 60px rgba(14, 165, 233, 0.16), 0 0 40px rgba(253, 164, 175, 0.10)",
        button: "0 18px 38px rgba(14,165,233,0.28)",
        "button-lg":
          "0 22px 46px rgba(14,165,233,0.36), inset 0 1px 0 rgba(255,255,255,0.4)",
      },
      keyframes: {
        spin: { to: { transform: "rotate(360deg)" } },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
        "pulse-pink": {
          "0%, 100%": {
            "box-shadow":
              "0 0 0 0 rgba(251,113,133,0.5), 0 18px 38px rgba(251,113,133,0.4)",
          },
          "50%": {
            "box-shadow":
              "0 0 0 18px rgba(251,113,133,0), 0 18px 38px rgba(251,113,133,0.4)",
          },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        wave: {
          "0%, 100%": { height: "8px" },
          "50%": { height: "36px" },
        },
      },
      animation: {
        spin: "spin 8s linear infinite",
        "pulse-ring": "pulse-ring 2s ease-out infinite",
        "pulse-pink": "pulse-pink 1.6s ease-out infinite",
        float: "float 4s ease-in-out infinite",
        "fade-up": "fade-up 0.5s ease both",
        wave: "wave 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
