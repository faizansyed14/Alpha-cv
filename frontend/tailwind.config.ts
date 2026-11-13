import type { Config } from 'tailwindcss'
/**
 * Design tokens.
 *
 * Every colour that describes a SURFACE or TEXT is a CSS variable in RGB channels (see globals.css), so one class works in both
 * themes: `bg-paper text-slate-900 border-slate-200` is white / near-black / hairline in light mode and deep navy-black / near-white /
 * dark hairline in dark mode. `white`, `black` and the rest of Tailwind's palette are literal.
 *
 *   navy      the brand: primary actions, selection, focus. In dark mode the scale brightens to an iris blue so it still reads.
 *   slate     the neutral scale (gray aliases it). Inverted in dark mode.
 *   paper     the card surface. canvas the background behind the cards.
 *   status    emerald / amber / red / rose / sky / violet tints: the 50-200 tints darken and the 600-800 inks brighten in dark mode.
 */
const channel = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (name: string, steps: (string | number)[]) =>
  Object.fromEntries(steps.map((s) => [s, channel(`${name}-${s}`)]));

const navy = { ...scale('navy', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]), DEFAULT: channel('navy-900') };
const slate = scale('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
const status = (name: string) => ({ ...scale(name, [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]), DEFAULT: channel(`${name}-600`) });

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy,
        brand: navy,
        blue: navy,
        azure: navy,
        iris: scale('iris', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        slate,
        gray: slate,
        ink: { DEFAULT: channel('slate-900'), muted: channel('slate-500'), soft: channel('slate-400') },
        solid: { DEFAULT: channel('solid'), hover: channel('solid-hover'), soft: channel('solid-soft'), active: channel('solid-active') },
        paper: channel('paper'),
        canvas: channel('canvas'),
        offwhite: channel('slate-50'),
        /** A true dark scrim for overlays in both themes. */
        scrim: 'rgb(8 11 22 / <alpha-value>)',
        emerald: status('emerald'),
        green: status('emerald'),
        amber: status('amber'),
        red: status('red'),
        rose: status('rose'),
        sky: status('sky'),
        violet: status('violet'),
        success: { DEFAULT: channel('emerald-600'), 50: channel('emerald-50'), 100: channel('emerald-100'), 600: channel('emerald-600'), 700: channel('emerald-700') },
        warning: { DEFAULT: channel('amber-600'), 50: channel('amber-50'), 100: channel('amber-100'), 500: channel('amber-500'), 600: channel('amber-600'), 700: channel('amber-700') },
        danger: { DEFAULT: channel('red-600'), 50: channel('red-50'), 100: channel('red-100'), 600: channel('red-600'), 700: channel('red-700') },
        info: { DEFAULT: channel('navy-800'), 50: channel('navy-50'), 100: channel('navy-100'), 600: channel('navy-700'), 700: channel('navy-800') },
        surface: {
          DEFAULT: channel('paper'),
          muted: channel('slate-50'),
          card: channel('paper'),
          /** Hairline outline of a card */
          border: channel('line'),
          /** A stronger line: inputs, dividers that must be seen */
          strong: channel('line-strong'),
        },
        border: channel('line'),
        input: channel('line-strong'),
        ring: channel('navy-600'),
        background: channel('canvas'),
        foreground: channel('slate-900'),
        primary: { DEFAULT: channel('navy-900'), foreground: 'rgb(255 255 255 / <alpha-value>)' },
        secondary: { DEFAULT: channel('slate-100'), foreground: channel('slate-900') },
        destructive: { DEFAULT: channel('red-600'), foreground: 'rgb(255 255 255 / <alpha-value>)' },
        muted: { DEFAULT: channel('slate-100'), foreground: channel('slate-500') },
        accent: { DEFAULT: channel('navy-50'), foreground: channel('navy-900') },
        popover: { DEFAULT: channel('paper'), foreground: channel('slate-900') },
        card: { DEFAULT: channel('paper'), foreground: channel('slate-900') },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // One type scale for the whole interface (a 1.125 step above 14px, tighter tracking as the size grows, like SF).
      //   2xs counters and eyebrows   xs secondary text   sm dense UI and table cells   base body
      //   md emphasised body / titles   lg card titles   xl-5xl section and page titles, hero numbers
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem", letterSpacing: "-0.004em" }],
        md: ["0.9375rem", { lineHeight: "1.5rem", letterSpacing: "-0.008em" }],
        lg: ["1.0625rem", { lineHeight: "1.5rem", letterSpacing: "-0.014em" }],
        xl: ["1.25rem", { lineHeight: "1.625rem", letterSpacing: "-0.02em" }],
        "2xl": ["1.5rem", { lineHeight: "1.875rem", letterSpacing: "-0.024em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.028em" }],
        "4xl": ["2.375rem", { lineHeight: "2.625rem", letterSpacing: "-0.032em" }],
        "5xl": ["3.25rem", { lineHeight: "3.4rem", letterSpacing: "-0.036em" }],
      },
      boxShadow: {
        soft: "var(--shadow-sm)",
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        panel: "var(--shadow-md)",
        pop: "var(--shadow-lg)",
        glow: "var(--shadow-glow)",
        glass: "var(--shadow-glass)",
        /** The glossy primary button: a hairline of light along the top edge */
        sheen: "var(--shadow-sheen)",
        none: "none",
      },
      borderRadius: {
        sm: "0.375rem",
        md: "0.5rem",
        lg: "0.625rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.25rem",
        "4xl": "1.5rem",
      },
      spacing: {
        "row": "var(--row-h)",
        "row-compact": "var(--row-h-compact)",
        "toolbar": "var(--toolbar-h)",
        "panel": "var(--panel-pad)",
      },
      backgroundImage: {
        /** Soft vertical light across a solid button */
        "btn-sheen": "linear-gradient(180deg, rgb(255 255 255 / 0.14), rgb(255 255 255 / 0) 55%)",
        /** The brand gradient for heroes and AI moments */
        "brand-gradient": "linear-gradient(135deg, rgb(var(--navy-950)) 0%, rgb(var(--navy-800)) 55%, rgb(var(--iris-600)) 100%)",
        "iris-gradient": "linear-gradient(135deg, rgb(var(--iris-500)), rgb(var(--navy-700)))",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        shimmer: { "0%": { backgroundPosition: "-1000px 0" }, "100%": { backgroundPosition: "1000px 0" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
        // `scale` and `translate` are their own CSS properties, so these animate on top of a dialog's centering `transform`
        // (-translate-x/y-1/2) instead of replacing it, which would push the dialog off-centre.
        "pop-in": { from: { opacity: "0", scale: "0.98", translate: "0 6px" }, to: { opacity: "1", scale: "1", translate: "0 0" } },
        "pop-out": { from: { opacity: "1", scale: "1" }, to: { opacity: "0", scale: "0.98" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        shimmer: "shimmer 2s infinite linear",
        "fade-in": "fade-in 180ms cubic-bezier(0.22,1,0.36,1) both",
        "fade-out": "fade-out 140ms ease-in both",
        "pop-in": "pop-in 220ms cubic-bezier(0.22,1,0.36,1) both",
        "pop-out": "pop-out 140ms ease-in both",
      },
    },
  },
  plugins: [],
}

export default config
