import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercentage(value: number, decimals = 1): string {
  if (isNaN(value) || !isFinite(value)) return '0%';
  return `${(value * 100).toFixed(decimals)}%`;
}
