import type { CreateTicketInput } from "../types/ticket";

export function slugify(title: string): string {
  let out = "";
  let lastWasDash = true;
  for (const ch of title) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      out += ch.toLowerCase();
      lastWasDash = false;
    } else if (!lastWasDash) {
      out += "-";
      lastWasDash = true;
    }
  }
  while (out.endsWith("-")) {
    out = out.slice(0, -1);
  }
  return out;
}

export function generateFilename(id: string, title: string): string {
  const slug = slugify(title);
  return slug.length > 0 ? `${id}-${slug}.md` : `${id}.md`;
}

export function withCollisionSuffix(filename: string, taken: Set<string>): string {
  if (!taken.has(filename)) return filename;
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let i = 2;
  while (taken.has(`${base}-${i}${ext}`)) {
    i += 1;
  }
  return `${base}-${i}${ext}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function splitTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function buildTicket(input: CreateTicketInput): CreateTicketInput {
  return input;
}