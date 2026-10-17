# GitTeam

AI-optimized ticket manager. Tickets are Markdown files on your disk, synced to your team's Git repo. Zero servers, zero accounts, zero cost. Built for teams that use AI to work on real code.

## Why

Most ticket tools (Jira, Linear, Notion) are opaque databases. You can't copy a ticket into a ChatGPT prompt without losing context, can't grep them, can't version them, can't back them up. GitTeam is the opposite: every ticket is a `.md` file on disk, in a Git repo your team owns. The "Copy for AI" button copies the raw markdown — same file the AI sees, no transformation.

## Quick path

```bash
# 1. Install dependencies (pnpm recommended)
pnpm install

# 2. Run in development mode
pnpm tauri dev

# 3. First run: paste your repo URL + GitHub PAT in the setup screen
#    PAT: https://github.com/settings/tokens/new (scope: repo)

# 4. Build a distributable
pnpm build:linux    # .AppImage
pnpm build:macos    # .app + .dmg
pnpm build:windows  # NSIS + MSI
```

## What you get

| Capability | How |
|---|---|
| Tickets as `.md` files | Frontmatter (YAML) + body (Markdown). Same file in your editor, in the UI, in Git, in the AI prompt |
| Team sync | Git repo (GitHub, GitLab, or any HTTPS remote). You own the data |
| AI-friendly | "Copy for AI" button copies the raw `.md` content. The AI gets the same file you see |
| Local-first | Full offline CRUD. Network only needed for sync |
| Secure credentials | PAT in OS keyring (Linux keyutils, macOS Keychain, Windows Credential Manager) |
| Auto-sync | 2-second debounce on edits; `ls-remote` every 15s detects remote changes; auto-pull on window focus |
| Conflict resolution | Side-by-side local vs remote preview per file (markdown rendered). Local / remote / both per file |
| Multi-project | Each repository gets its own local checkout and its own keyring entry. Switch boards from the header (⌘K · `g k` for the board, `g g` for the graph) |
| Ticket graph | Link tickets with `links: ["TKT-1039"]` in frontmatter and explore them in an Obsidian-style force graph. Hover highlights neighbours, drag moves a node, click opens the ticket |
| Views | Board and Graph, toggled from the header. `Y` copies the ticked-off ticket ID anywhere |
| Themeable | All colors, type and spacing come from CSS custom properties. `default`, `light` and `obsidian` token sets ship in `src/index.css` |
| Zero telemetry | No analytics, no remote calls outside your configured repo |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript + Vite (frontend)                    │
│  Vanilla CSS with design tokens · Zustand · react-markdown  │
└──────────────────────────┬──────────────────────────────────┘
                           │ invoke() via Tauri IPC
┌──────────────────────────┴──────────────────────────────────┐
│  Rust backend (Tauri 2)                                     │
│  • 33 Tauri commands (tickets, git, conflicts, graph)       │
│  • keyring crate (OS-native credential storage)             │
│  • tokio for async subprocess management                    │
│  • gray_matter for frontmatter roundtrip                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ std::process::Command
┌──────────────────────────┴──────────────────────────────────┐
│  Git CLI (spawned)                                          │
│  PAT embedded in URL: https://x-access-token:PAT@host/...   │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ▼
                    Your team's repo
                    (checked out under ~/.gitteam/projects/)
```

## Ticket file format

```markdown
---
id: TKT-1042
title: "Update CSV parser for UTF-16"
status: "in-progress"
assignee: "carlos-dev"
priority: "high"
tags: ["backend", "python", "data"]
links: ["TKT-1039", "TKT-1002"]
last_updated: "2026-10-13T11:00:00Z"
---

# Context
The current parser fails on UTF-16 CSV files.

# Requirements
- Detect encoding before processing
- Keep algorithmic complexity at O(n)

# Current code
[paste code here]
```

Filenames follow `{id}-{slug}.md` (e.g. `TKT-1042-update-csv-parser-for-utf-16.md`). IDs auto-increment from 1000.

`links` is optional and only written once a ticket has links, so existing files are never rewritten just to add an empty key. A link points at another ticket's id; the graph draws one undirected edge per linked pair (so `A → B` and `B → A` are a single edge) and ignores links to tickets that do not exist.

## Where files live

```
~/.gitteam/
  .active                        id of the active project
  projects/
    <project-id>/
      config.json                repo URL + git user name/email + last sync (never the PAT)
      repo/                      the git checkout — the ticket .md files live here
```

One directory per repository, so projects never share a checkout or a credential. `project-id` is derived from the repo name (lowercased, `-2`/`-3` appended on collision). The PAT for a project lives in the OS keyring under `gitteam/<project-id>`.

Without an active project the app falls back to the original single-project layout (`~/.gitteam-data/` and `~/.gitteam-config.json`), so nothing from before the multi-project change is lost.

## Project layout

```
src/                   React frontend
  components/          UI components (tickets, graph, setup, conflicts, layout, ui primitives)
  lib/                 Tauri command wrappers, markdown utils, shortcut table, toast bus
  store/               Zustand store
  types/               TypeScript types
src-tauri/             Rust backend
  src/lib.rs           All 33 Tauri commands + the Rust test suite
  capabilities/        Tauri 2 permission scopes
odd/tasks/             Feature documents (this project's source of truth)
```

See `odd/tasks/gitteam-app.md` for the full architecture plan and `odd/tasks/fase-6-v2-redesign.md` for the v2 redesign, multi-project and graph work.

## Security model

- **PAT**: stored in OS keyring via the `keyring` crate. Service name `gitteam` for the legacy single-project layout, `gitteam/<project-id>` for each linked project; user `github-pat`. Never written to disk, never logged, never sent to JS.
- **Config file**: `<project>/config.json` under `~/.gitteam/projects/` (legacy fallback: `~/.gitteam-config.json`). It sits *next to* the checkout, not inside it, so the ticket repo never has a permanently untracked config file. Contains only repo URL, git user name/email, last sync timestamp. PAT is never in this file.
- **Git operations**: PAT is embedded in the remote URL per command (`https://x-access-token:PAT@github.com/...`). The URL is not persisted. Git's credential helper is not used.
- **No telemetry**: zero outbound network calls except to the configured Git remote.
- **File I/O**: 100% in Rust (Tauri commands). No `fs` permission exposed to JS.

## Build targets

| Target | Command | Output | Notes |
|---|---|---|---|
| Linux | `pnpm build:linux` | `.AppImage` | Portable, runs on any modern Linux. Needs `webkit2gtk-4.1` |
| macOS | `pnpm build:macos` | `.app` + `.dmg` | Must run on macOS |
| Windows | `pnpm build:windows` | NSIS + MSI installers | Must run on Windows or with cross-toolchain |
| Dev (no bundle) | `pnpm build:dev` | Compiled binary | Faster, for testing |

## Development

Prerequisites: Node 18+, Rust 1.77+, pnpm, `git` in PATH.

```bash
pnpm install
pnpm tauri dev          # hot-reload dev mode
pnpm exec tsc --noEmit  # type check
pnpm exec vite build    # frontend build
cd src-tauri && cargo check   # rust type check
cd src-tauri && cargo test    # rust tests (frontmatter, links, graph edges)
```

## Roadmap

This project shipped its 4-phase plan (local MVP, Git sync, acceleration, conflict resolution). Not in scope:

- Real-time collaboration (CRDT/Yjs)
- Mobile clients
- Binary attachments
- Built-in time tracking
- A frontend test runner (the Rust backend has a `cargo test` suite covering frontmatter, links and graph edges; the frontend is still verified by `tsc` + build)

## License

Pick one before going public. MIT recommended for AI-friendly tools.

## Acknowledgments

Built with [Tauri](https://tauri.app), [React](https://react.dev), [Vite](https://vitejs.dev), [Zustand](https://github.com/pmndrs/zustand), [gray-matter](https://github.com/jonschlinkert/gray-matter), [lucide-react](https://lucide.dev), and the [`keyring`](https://github.com/hwchen/keyring-rs) crate.

The UI is styled with plain CSS driven by custom properties in `src/index.css` — no CSS framework. Links between tickets follow the `[[wiki-link]]` idea from [Obsidian](https://obsidian.md), which also inspired the graph view.
