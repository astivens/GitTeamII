// Tiny utilities for the avatar component.
// No React, no DOM access — safe to import anywhere.

const PALETTE = [
  "bg-rose-500/20",
  "bg-orange-500/20",
  "bg-amber-500/20",
  "bg-emerald-500/20",
  "bg-cyan-500/20",
  "bg-blue-500/20",
  "bg-violet-500/20",
  "bg-fuchsia-500/20",
] as const;

/** djb2-ish hash — stable across runs, no crypto needed. */
function hashName(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i += 1) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function nameToColor(name: string): string {
  if (!name) return PALETTE[0];
  return PALETTE[hashName(name) % PALETTE.length];
}

export function nameToInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const single = parts[0];
  return single.slice(0, 2).toUpperCase();
}