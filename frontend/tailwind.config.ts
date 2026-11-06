import type { Config } from 'tailwindcss'
const {
  default: flattenColorPalette,
} = require("tailwindcss/lib/util/flattenColorPalette");

/**
 * Design tokens.
 *
 * Deep navy from the dashboard hero (`#16204B`) for actions, selection and focus.
 * White / near-white surfaces everywhere else. Soft tints stay cool and quiet — no bright electric blue.
 * `brand` and Tailwind `blue` alias navy so existing classes pick this up.
 */
const navy = {
  50: "#F5F7FB",
  100: "#E8ECF5",
  200: "#CDD4E6",
  300: "#A4B0CC",
  400: "#7384AE",
  500: "#4A5D8F",
  600: "#2A3F72",
  700: "#1E3260",
  800: "#182853",
  900: "#16204B",
  /** Dashboard hero — keep in sync with primary actions */
  950: "#16204B",
  DEFAULT: "#16204B",
};

const azure = {
  50: "#F5F7FB",
  100: "#E8ECF5",
  200: "#CDD4E6",
  300: "#A4B0CC",
  400: "#7384AE",
  500: "#4A5D8F",
  600: "#2A3F72",
  700: "#1E3260",
  800: "#182853",
  900: "#16204B",
  DEFAULT: "#16204B",
};

const neutral = {
  50: "#f8fafc",
  100: "#f1f5f9",
  200: "#e2e8f0",
  300: "#cbd5e1",
  400: "#94a3b8",
  500: "#64748b",
  600: "#475569",
  700: "#334155",
  800: "#1e293b",
  900: "#0f172a",
  950: "#020617",
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
        brand: navy,
        blue: navy,
        azure,
        ink: {
          DEFAULT: "#0f172a",
          muted: "#64748b",
        },
        slate: neutral,
        gray: neutral,
        paper: "#FFFFFF",
        offwhite: "#f8fafc",
        // Semantic status colours
        success: { DEFAULT: "#1f7a4d", 50: "#f0faf4", 100: "#dcf3e6", 600: "#1f7a4d", 700: "#17613c" },
        warning: { DEFAULT: "#96640f", 50: "#fdf7ea", 100: "#faecc8", 500: "#b07818", 600: "#96640f", 700: "#7a500b" },
        danger: { DEFAULT: "#c0392b", 50: "#fdf2f1", 100: "#fadedb", 600: "#c0392b", 700: "#9d2d21" },
        info: { DEFAULT: navy[800], 50: navy[50], 100: navy[100], 600: navy[700], 700: navy[800] },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#FAFBFD",
          card: "#FFFFFF",
          /** Thin soft-navy card outline (lighter than hero fill) */
          border: "#C5CEE0",
          strong: "#9AA8C4",
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
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      // One type scale for the whole interface.
      //   2xs labels and counters   xs secondary text   sm controls and dense UI   base body
      //   md emphasised body        lg card titles      xl-5xl section and page titles
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem" }],
        md: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.625rem", letterSpacing: "-0.011em" }],
        xl: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.014em" }],
        "2xl": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.018em" }],
        "3xl": ["1.875rem", { lineHeight: "2.375rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.375rem", { lineHeight: "2.75rem", letterSpacing: "-0.022em" }],
        "5xl": ["3.25rem", { lineHeight: "3.5rem", letterSpacing: "-0.026em" }],
      },
      boxShadow: {
        soft: "var(--shadow-sm)",
        card: "var(--shadow-card)",
        panel: "var(--shadow-md)",
        glow: "var(--shadow-glow)",
      },
      borderRadius: {
        md: "0.5rem",
        lg: "0.625rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.25rem",
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
