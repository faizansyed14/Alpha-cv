import { cn } from "@/lib/utils";

/** Soft, deterministic tints so a list of people does not read as one block of blue. */
const TINTS = [
  "bg-navy-50 text-navy-700 ring-navy-100",
  "bg-violet-50 text-violet-700 ring-violet-100",
  "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "bg-amber-50 text-amber-700 ring-amber-100",
  "bg-rose-50 text-rose-700 ring-rose-100",
  "bg-cyan-50 text-cyan-700 ring-cyan-100",
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
export function Avatar({ name, size = "md", className }: { name?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-1 ring-inset",
        size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs",
        tintOf(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export default Avatar;
