import type { Config } from 'tailwindcss'
const {
  default: flattenColorPalette,
} = require("tailwindcss/lib/util/flattenColorPalette");

/**
 * Navy foundation + lighter navy accent (CTAs, active dots, stats).
 * brand* aliases navy so existing brand-* classes stay on foundation.
 */
const navy = {
  50: "#F1F5FA",
  100: "#DEE9F5",
  200: "#B8CDE5",
  300: "#7BA3CC",
  400: "#4A82BE",
  500: "#2F6BB0",
  600: "#0B3D7A",
  700: "#0B3D7A",
  800: "#032E62",
  900: "#041B3D",
  950: "#021229",
  DEFAULT: "#032E62",
};

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        navy,
        // brand → navy (foundation). Accent CTAs use navy-400/500 (lighter).
        brand: {
          ...navy,
          // Most common "primary fill" step historically was 600
          600: navy[800],
          700: navy[700],
          DEFAULT: navy[800],
        },
        ink: {
          DEFAULT: "#0A0A0A",
          muted: "#1F2937",
        },
        // Darker slate text steps — keeps light fills (50–300), hardens body copy
        slate: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#475569",
          500: "#1E293B",
          600: "#0F172A",
          700: "#020617",
          800: "#000000",
          900: "#000000",
          950: "#000000",
        },
        gray: {
          50: "#F9FAFB",
          100: "#F3F4F6",
          200: "#E5E7EB",
          300: "#D1D5DB",
          400: "#4B5563",
          500: "#1F2937",
          600: "#111827",
          700: "#030712",
          800: "#000000",
          900: "#000000",
          950: "#000000",
        },
        paper: "#FFFFFF",
        offwhite: "#F1F5FA",
        // Semantic status colors
        success: {
          DEFAULT: "#16A34A",
          50: "#F0FDF4",
          100: "#DCFCE7",
          600: "#16A34A",
          700: "#15803D",
        },
        warning: {
          DEFAULT: "#F59E0B",
          50: "#FFFBEB",
          100: "#FEF3C7",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
        },
        danger: {
          DEFAULT: "#DC2626",
          50: "#FEF2F2",
          100: "#FEE2E2",
          600: "#DC2626",
          700: "#B91C1C",
        },
        info: {
          DEFAULT: navy[500],
          50: navy[50],
          100: navy[100],
          600: navy[500],
          700: navy[700],
        },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#F1F5FA",
          card: "#DEE9F5",
          border: "#B8CDE5",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        shimmer: "shimmer 2s infinite linear",
      },
    },
  },
  plugins: [addVariablesForColors],
}

function addVariablesForColors({ addBase, theme }: any) {
  let allColors = flattenColorPalette(theme("colors"));
  let newVars = Object.fromEntries(
    Object.entries(allColors).map(([key, val]) => [`--${key}`, val])
  );

  addBase({
    ":root": newVars,
  });
}

export default config
