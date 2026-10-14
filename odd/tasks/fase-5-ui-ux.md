# Fase 5 — UI/UX improvements (audit-driven)

## Goal

Implement the top P0 items from `ui-ux-audit.md`:
1. **Command palette** (Cmd+K) — search, navigate, create, sync from one input
2. **Drag-and-drop** between Kanban columns
3. **Identity in header** — avatar + git user name
4. **Onboarding after setup** — welcome state with quick action hints
5. **Keyboard shortcuts** — Cmd+K (palette), n (new ticket), esc (close modal), / (focus search), ? (help)

Explicitly out of scope this round:
- **Side panel for ticket detail** (P0-3) — biggest change, modal stays for now
- All P1 and P2 items

## Scope decisions

- Use `cmdk` for the command palette (well-tested, ~10KB gzipped, works great with Tailwind)
- HTML5 native drag-and-drop (no extra deps)
- Avatar is a 2-line component (initials in colored circle, color from hash of name)
- Onboarding replaces the existing `EmptyState` when there are 0 tickets AND the user just finished setup (track with a `just_setup: boolean` flag that auto-clears on first ticket creation)

## Acceptance criteria

- [ ] Pressing Cmd+K (or Ctrl+K) opens the command palette
- [ ] Palette allows: creating a ticket, syncing now, disconnecting, searching tickets
- [ ] Search filters tickets by id, title, tags, assignee (case-insensitive)
- [ ] Esc closes the palette
- [ ] Drag a ticket card from one column to another → status updates and persists
- [ ] Visual feedback when dragging over a column (ring/inset)
- [ ] Cannot drop on the same column (no-op)
- [ ] Header shows the configured git user name + a colored avatar
- [ ] Onboarding welcome state appears on first sync + empty board
- [ ] `n` opens the new ticket modal
- [ ] `?` opens a help overlay with all shortcuts
- [ ] All existing functionality still works
- [ ] `pnpm exec tsc --noEmit` passes
- [ ] `pnpm exec vite build` passes

## Files affected

- `package.json` — add `cmdk`
- `src/lib/keyboard.ts` (NEW) — keyboard shortcut hook
- `src/lib/avatar.ts` (NEW) — name-to-color hash + initials
- `src/components/ui/CommandPalette.tsx` (NEW) — the palette
- `src/components/ui/Avatar.tsx` (NEW) — small avatar component
- `src/components/ui/HelpOverlay.tsx` (NEW) — keyboard shortcuts help
- `src/components/tickets/Column.tsx` — drag-over handlers
- `src/components/tickets/TicketCard.tsx` — draggable
- `src/components/layout/AppHeader.tsx` — identity display, "Search... ⌘K" button
- `src/components/layout/EmptyState.tsx` — onboarding variant
- `src/store/tickets.ts` — openCommandPalette action, just_setup flag, search query
- `src/App.tsx` — mount palette + help overlay + keyboard hook

## Risk

- Drag-and-drop with HTML5 has quirks (drag image, ghosting). Test on Linux primarily.
- `cmdk` adds a dep. If it conflicts with anything, fall back to a hand-rolled simple command list.
- `window.confirm()` for disconnect remains (P1-8, not in this round).

## Verification

After implementation:
1. `pnpm exec tsc --noEmit` — must pass
2. `pnpm exec vite build` — must pass
3. (Optional) `pnpm tauri dev` to manually test the new flow
