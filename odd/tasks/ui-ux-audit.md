# GitTeam — UI/UX Audit

**Date**: 2026-10-13
**Author**: orchestrator (post-Fase 4)
**Scope**: User-facing surface of the desktop app (React + Tailwind layer)
**Method**: Code-driven audit. ASCII wireframes reproduce the current screens from the actual `src/components/*` code. Gaps and proposals derived from comparing current state to Linear/Notion-grade ticket managers.

---

## Design read

- **Page kind**: B2B dev-tool desktop app for technical teams that use AI
- **Audience**: developers, technical PMs, small teams (2-8 people) on remote work
- **Vibe**: Linear-clean, dark, restrained motion, opinionated
- **Density**: daily app (4-7 on the density dial — not art gallery, not cockpit)
- **Existing palette** is locked: zinc-style dark surfaces, single violet accent (`#7c5cff`), status/priority semantic colors. Don't introduce new accent colors.

## Dials

- **DESIGN_VARIANCE**: 5 (offset, not symmetric)
- **MOTION_INTENSITY**: 4 (hover/active/focus only; no scroll-jacking or perpetual micro-anims)
- **VISUAL_DENSITY**: 4 (standard web-app padding: `py-16` to `py-24`)

## TL;DR — what to do first

Five high-impact changes that compound:

1. **Command palette** (`Cmd+K`) — single biggest UX upgrade. Search, navigate, create, sync — all from one input.
2. **Drag-and-drop** between columns — fundamental Kanban interaction; without it the app feels half-built.
3. **Ticket detail side panel** — replace the create/edit modal pattern with a right-side drawer. Better for browsing, leaves the board context visible.
4. **Identity in header** — show "logged in as astivens" + an avatar. Anchors the user's relationship to the sync state.
5. **Sync activity log** — small expandable panel showing last N sync events. Builds trust in the "Git invisible" promise.

Skip these (low ROI for this stage): bulk select, full-text search indexing, theme toggle, mobile breakpoints (desktop-only app).

---

## Current state — wireframes

ASCII mockups from the actual `src/components/*` code. Not exact, but proportional.

### Screen 1: Kanban board (main view)

```
+----------------------------------------------------------------------------+
| GitTeam    [~] Synced 2 min ago                  [Sync] [Plug] [+ New]      |  <- 56px header
+----------------------------------------------------------------------------+
| /home/anuar/.gitteam-data                                                   |  <- data dir mono path
+----------------------------------------------------------------------------+
|  BACKLOG  3    |  IN PROGRESS  2  |  REVIEW  1   |  DONE  5                |
|  ---------    |  -------------  |  ----------   |  --------                 |
|               |                 |               |                           |
|  o TKT-1042   |  o TKT-1041     |  o TKT-1038  |  o TKT-1030               |
|    Update CSV |    Refactor API |    Auth UX   |    Onboard flow           |
|    carlos-dev |    priya        |    astivens  |    astivens               |
|    #backend   |    #api #urgent |    #auth     |    #growth                |
|               |                 |               |                           |
|  o TKT-1040   |  o TKT-1037     |               |  o TKT-1029               |
|    ...        |    ...          |               |    ...                    |
|               |                 |               |                           |
+----------------------------------------------------------------------------+
| [Archived] dropdown filter (status shown but no column)                     |
+----------------------------------------------------------------------------+
```

**Properties**:
- 4-column flex layout, no drag-and-drop
- No search bar
- No way to filter by assignee, tag, priority
- Archived tickets hidden, no visible filter
- No per-column priority breakdown
- No "your tickets" / "assigned to me" filter

### Screen 2: SetupScreen (first-run only)

```
                                  +-----------------------------------+
                                  |         [GitBranch icon]          |
                                  |           GitTeam                  |
                                  +-----------------------------------+
                                  | Connect your team's repository    |
                                  | GitTeam will clone it to           |
                                  | ~/.gitteam-data and keep it in     |
                                  | sync.                              |
                                  |                                    |
                                  | Repository URL                     |
                                  | [https://github.com/.../....git]  |
                                  |                                    |
                                  | Personal access token              |
                                  | [ghp_......................]       |
                                  | GitHub -> ... (helper)             |
                                  |                                    |
                                  | Git user name    | Git user email  |
                                  | [Carlos Dev]     | [carlos@x.com]  |
                                  |                                    |
                                  | [Test & Connect]                   |
                                  +-----------------------------------+
```

**Properties**:
- No way to skip (must provide a repo)
- No link to docs or "how to create a PAT"
- No test connection in isolation (Test & Connect does both at once)
- No way to use local-only mode (Fase 1 functionality was lost when Fase 2 made SetupScreen mandatory)

### Screen 3: TicketModal (create/edit)

```
                  +---------------------------------------------------+
                  | New ticket                                       [X] |
                  +---------------------------------------------------+
                  | Title                                            |
                  | [Short, action-oriented summary]                  |
                  |                                                   |
                  | Status            | Priority                       |
                  | [Backlog v]       | [Medium v]                     |
                  |                                                   |
                  | Assignee          | Tags                           |
                  | [username]        | [comma, separated]              |
                  |                                                   |
                  | Body                                              |
                  | +---------------------------------------+        |
                  | | # Context                             |        |
                  | | Markdown body — context, requirements |        |
                  | | ...                                   |        |
                  | +---------------------------------------+        |
                  |                                                   |
                  | [Copy for AI] [Delete]    [Cancel] [Save]         |
                  +---------------------------------------------------+
```

**Properties**:
- Blocks entire board (modal overlay)
- No markdown preview side-by-side
- No validation hints until you click Save
- "Copy for AI" only in edit mode (correct), but no way to see what gets copied
- Delete requires `window.confirm()` (ugly, blocking)
- No keyboard shortcuts (Esc closes, but no Cmd+S to save)

---

## Gaps — categorized and prioritized

### P0 — must-have for a competitive ticket tool

| # | Gap | Why it matters | Effort |
|---|-----|----------------|--------|
| 1 | No search/filter | With >20 tickets the board becomes unscannable | M |
| 2 | No drag-and-drop | Kanban without drag feels broken; users expect it | M |
| 3 | Modal blocks board for edits | Forces context loss; side panel is the modern pattern | L |
| 4 | No identity in header | User doesn't see who's "logged in" (i.e. whose commits are these) | S |
| 5 | No keyboard shortcuts | Power users can't operate; competitive tools have them | S |
| 6 | No onboarding beyond setup | First-time users don't know what to do after sync | S |

### P1 — improves the "Git invisible" promise

| # | Gap | Why it matters | Effort |
|---|-----|----------------|--------|
| 7 | No sync activity log | User has to trust the header indicator; logs build trust | M |
| 8 | Disconnect button is one-click fatal | No confirmation, no warning about losing config | S |
| 9 | No markdown preview in modal | Hard to see the body render before saving | S |
| 10 | No "your tickets" filter | Useful when team is small; you want to see your own work | S |
| 11 | No tag global view | Tags are scattered; hard to find all `urgent` tickets | M |

### P2 — polish (do when there's nothing else)

| # | Gap | Why it matters | Effort |
|---|-----|----------------|--------|
| 12 | No bulk select | Multi-edit is rare; low ROI | L |
| 13 | No theme toggle | Dark only is fine for now; skip | S |
| 14 | No mobile breakpoints | Desktop-only app; skip | — |
| 15 | No skeleton loaders | Just a spinner; ok for a v1 | S |
| 16 | Toast positioning can overlap | Bottom-right is fine; rarely collides | S |
| 17 | Per-column priority breakdown | Nice-to-have stats | S |
| 18 | No "recently viewed" | Probably not needed for <100 tickets | M |

### Out of scope (deferred indefinitely)

- Real-time collaboration (CRDT, WebSocket)
- Mobile clients
- Comments / threading
- File attachments
- Time tracking
- Custom ticket types / fields
- Webhooks / integrations

---

## Proposals — with code

### P0-1: Command palette (Cmd+K)

The single highest-ROI change. Covers search, navigation, and most actions in one input.

**Wireframe**:
```
                     +-----------------------------------+
                     | [  type to search...           ] [Esc] |
                     +-----------------------------------+
                     | > Create new ticket                  |
                     |   Go to In Progress                  |
                     |   Go to Review                       |
                     |   Go to Done                         |
                     |   Sync now                           |
                     |   Disconnect repository              |
                     | ---                                  |
                     |   TICKETS                            |
                     |   TKT-1042  Update CSV parser        |
                     |   TKT-1041  Refactor API             |
                     |   ...                                |
                     +-----------------------------------+
```

**Implementation sketch**:

```tsx
// src/components/CommandPalette.tsx
import { useEffect, useState } from "react";
import { Command } from "cmdk"; // install: pnpm add cmdk
import { useTicketsStore } from "../store/tickets";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const tickets = useTicketsStore((s) => s.tickets);
  const create = useTicketsStore((s) => s.create);
  const syncNow = useTicketsStore((s) => s.syncNow);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Global command palette">
      <Command.Input placeholder="Type a command or search..." />
      <Command.List>
        <Command.Group heading="Actions">
          <Command.Item onSelect={() => { create({ title: "Untitled" }); setOpen(false); }}>
            Create new ticket
          </Command.Item>
          <Command.Item onSelect={() => { void syncNow(); setOpen(false); }}>
            Sync now
          </Command.Item>
        </Command.Group>
        <Command.Group heading="Tickets">
          {tickets.map((t) => (
            <Command.Item key={t.filename} onSelect={() => { /* open detail panel */ setOpen(false); }}>
              <span className="font-mono text-fg-muted">{t.id}</span>
              <span className="ml-2">{t.title}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
```

Mount once in `App.tsx`. Add a hint button to the header: `Search... ⌘K`.

### P0-2: Drag-and-drop between columns

Use HTML5 drag-and-drop (no extra deps). Status change on drop.

**Implementation sketch**:

```tsx
// src/components/tickets/Column.tsx
import { useState } from "react";
import { updateTicket } from "../../lib/tauri";

export function Column({ status, tickets, onSelect }: ColumnProps) {
  const [dragOver, setDragOver] = useState(false);
  const refresh = useTicketsStore((s) => s.refresh);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const filename = e.dataTransfer.getData("text/x-ticket-filename");
    const ticket = tickets.find((t) => t.filename === filename);
    if (!ticket || ticket.status === status) return;
    await updateTicket(ticket.filename, {
      title: ticket.title,
      status,
      priority: ticket.priority,
      assignee: ticket.assignee,
      tags: ticket.tags,
      body: ticket.body,
    });
    await refresh();
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn("...", dragOver && "ring-2 ring-accent ring-inset")}
    >
      {/* existing column content */}
    </div>
  );
}

// src/components/tickets/TicketCard.tsx
<div
  draggable
  onDragStart={(e) => e.dataTransfer.setData("text/x-ticket-filename", ticket.filename)}
  className="..."
>
```

### P0-3: Ticket detail side panel

Replace `TicketModal` for **edit** with a right-side drawer; keep modal for **create** (quicker, less context).

**Wireframe**:
```
+--------------------------------------------+
|                  BOARD                     |
|                                +---------+ |
|  [columns...]                  | TKT-1042| |
|                                |---------|
|                                | Title  |
|                                | [..]   |
|                                |         |
|                                | Status | Priority |
|                                | Body   |
|                                | [edit] |
|                                | [Copiar] |
|                                | [Delete]|
+--------------------------------+---------+
```

**Implementation sketch** (using `vaul` or just CSS):

```tsx
// src/components/tickets/TicketPanel.tsx
import { Drawer } from "vaul"; // or roll your own

export function TicketPanel() {
  const selected = useTicketsStore((s) => s.selectedId);
  const ticket = useTicketsStore((s) => s.tickets.find((t) => t.filename === s.selectedFilename));
  const close = () => useTicketsStore.setState({ selectedId: null });

  return (
    <Drawer.Root open={!!ticket} onOpenChange={(o) => !o && close()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content className="fixed right-0 top-0 bottom-0 w-[640px] bg-bg-elevated p-6 shadow-elevated">
          {/* same form as TicketModal */}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

Or without deps: a fixed-positioned `<aside>` with slide-in animation, Esc to close, click-outside to close.

### P0-4: Identity in header

**Wireframe**:
```
| GitTeam  Synced 2m  [Sync] [Plug] [astivens ▾] [+ New] |
```

**Implementation**:

```tsx
// src/components/layout/AppHeader.tsx
import { gitConfig } from useTicketsStore();

{gitConfig ? (
  <div className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-bg-hover">
    <Avatar name={gitConfig.git_user_name} size={20} />
    <span className="text-sm text-fg-muted">{gitConfig.git_user_name}</span>
  </div>
) : null}
```

`<Avatar>` is a 2-line component (initials in a colored circle based on hash of name).

### P0-5: Keyboard shortcuts

Build a small `useKeyboardShortcuts` hook:

```tsx
// src/lib/keyboard.ts
export function useGlobalShortcuts() {
  const openPalette = useTicketsStore((s) => s.openCommandPalette);
  const create = useTicketsStore((s) => s.openCreateModal);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); openPalette(); }
      else if (mod && e.key === "n") { e.preventDefault(); create(); }
      else if (e.key === "/") { /* focus search */ }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, create]);
}
```

Mount in `App.tsx`. Show a small footer hint with shortcuts (`?` for help overlay).

### P0-6: Onboarding after setup

After successful `git_setup_repo`, show a 3-step inline tour in the empty state:

```
+----------------------------------------------+
| Welcome to GitTeam                           |
|                                              |
| 1. Create your first ticket (press n)        |
| 2. The ticket saves to disk + syncs to Git   |
| 3. Press Cmd+K to search, navigate, sync     |
|                                              |
| [Create your first ticket]                   |
+----------------------------------------------+
```

Replace the current `EmptyState` component.

---

### P1 highlights

**P1-7: Sync activity log** — small expandable section in the header (or a dedicated `/activity` route) showing last 20 events:

```ts
type SyncEvent =
  | { kind: "commit"; sha: string; message: string; at: string }
  | { kind: "pull"; commits: number; files: number; at: string }
  | { kind: "push"; sha: string; at: string }
  | { kind: "conflict"; files: string[]; at: string }
  | { kind: "error"; message: string; at: string };
```

New store field `activity: SyncEvent[]`, appended on every successful sync action. Display as a side drawer or popover from the sync indicator.

**P1-8: Confirm before disconnect** — `window.confirm()` is ugly. Replace with a small modal: "Disconnect from `repo-name`? Your local tickets will be preserved but won't sync anymore." Two-step action.

**P1-9: Markdown preview in modal/panel** — split-pane: left is markdown source, right is rendered (using existing `react-markdown`). Toggle button to switch modes.

---

## Implementation roadmap

Order matters: the command palette and drag-and-drop are foundations that other features benefit from.

| Order | Item | Depends on | Estimated effort |
|-------|------|------------|------------------|
| 1 | Keyboard shortcuts (P0-5) | nothing | 2 hours |
| 2 | Identity in header (P0-4) | nothing | 1 hour |
| 3 | Command palette (P0-1) | keyboard shortcuts | 4 hours |
| 4 | Drag-and-drop (P0-2) | nothing | 3 hours |
| 5 | Onboarding (P0-6) | nothing | 2 hours |
| 6 | Side panel (P0-3) | command palette (for "open in palette") | 6 hours |
| 7 | Sync activity log (P1-7) | nothing | 4 hours |
| 8 | Disconnect confirm (P1-8) | nothing | 1 hour |
| 9 | Markdown preview (P1-9) | side panel | 2 hours |
| 10 | "Your tickets" filter (P1-10) | command palette | 1 hour |

**Total estimated**: ~26 hours of work. Phase 5 if you want to call it that.

---

## What this audit is NOT

- A pixel-perfect redesign. ASCII wireframes are for layout intent, not visual fidelity.
- A new visual language. The dark Linear-inspired palette and tokens stay locked.
- A Figma file. OpenPencil MCP bridge wasn't stable in this environment; an alternative markdown audit was produced instead.
- A feature request list from real users. This is a code-driven audit; no user research was done.

## What to do next

1. Pick 2-3 items from the P0 list to ship in the next iteration
2. The command palette + drag-and-drop + keyboard shortcuts together transform the app from "functional" to "feels right"
3. If you want to ship the side panel, the existing `TicketModal` can be replaced wholesale; the create flow keeps the modal pattern, the edit flow moves to the panel
