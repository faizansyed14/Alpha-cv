import { cn } from "@/lib/utils";

/** Deterministic duotone tiles, so a list of people reads as people and not as one block of blue. */
const TINTS = [
  "bg-navy-50 text-navy-800 ring-navy-200/70",
  "bg-violet-50 text-violet-700 ring-violet-200/70",
  "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  "bg-amber-50 text-amber-700 ring-amber-200/70",
  "bg-rose-50 text-rose-700 ring-rose-200/70",
  "bg-sky-50 text-sky-700 ring-sky-200/70",
  "bg-iris-50 text-iris-700 ring-iris-200/70",
];

export function initialsOf(name?: string | null): string {
  const parts = String(name || "").trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function tintOf(name?: string | null) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** Initials avatar; no network requests. */
export function Avatar({ name, size = "md", className }: { name?: string | null; size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-[0.02em] ring-1 ring-inset",
        size === "xs" ? "h-6 w-6 text-[9px]" : size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : size === "xl" ? "h-14 w-14 text-lg" : "h-9 w-9 text-xs",
        tintOf(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export default Avatar;
