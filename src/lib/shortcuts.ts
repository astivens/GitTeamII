// Static list of keyboard shortcuts surfaced in the HelpOverlay.
// Mac-style glyphs in `keys`; the runtime listener maps Cmd → Ctrl on
// non-Mac platforms automatically.
//
// `action` is a key of the `layout` dictionary, not a sentence: HelpOverlay
// renders `t.layout[action]` so the help follows the chosen language.

export const SHORTCUTS = [
  { keys: ["⌘", "K"], action: "shortcutOpenPalette" },
  { keys: ["N"], action: "shortcutNewTicket" },
  { keys: ["/"], action: "shortcutSearchTickets" },
  { keys: ["Y"], action: "shortcutCopyLastTicketId" },
  { keys: ["G", "K"], action: "shortcutBoardView" },
  { keys: ["G", "G"], action: "shortcutGraphView" },
  { keys: ["?"], action: "shortcutShowShortcuts" },
  { keys: ["Esc"], action: "shortcutCloseModal" },
] as const;

export type Shortcut = (typeof SHORTCUTS)[number];
