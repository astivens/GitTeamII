// Static list of keyboard shortcuts surfaced in the HelpOverlay.
// Mac-style glyphs in `keys`; the runtime listener maps Cmd → Ctrl on
// non-Mac platforms automatically.

export const SHORTCUTS = [
  { keys: ["⌘", "K"], action: "Open command palette" },
  { keys: ["N"], action: "New ticket" },
  { keys: ["/"], action: "Search tickets" },
  { keys: ["Y"], action: "Copy the last viewed ticket ID" },
  { keys: ["G", "K"], action: "Board view" },
  { keys: ["G", "G"], action: "Graph view" },
  { keys: ["?"], action: "Show keyboard shortcuts" },
  { keys: ["Esc"], action: "Close modal or dialog" },
] as const;

export type Shortcut = (typeof SHORTCUTS)[number];