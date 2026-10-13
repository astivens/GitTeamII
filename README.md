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
| Zero telemetry | No analytics, no remote calls outside your configured repo |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript + Vite + Tailwind (frontend)         │
│  Zustand store · react-markdown for previews                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ invoke() via Tauri IPC
┌──────────────────────────┴──────────────────────────────────┐
│  Rust backend (Tauri 2)                                      │
│  • 25 Tauri commands (ticket CRUD, git, conflict resolve)    │
│  • keyring crate (OS-native credential storage)              │
│  • tokio for async subprocess management                     │
│  • gray_matter for frontmatter roundtrip                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ std::process::Command
┌──────────────────────────┴──────────────────────────────────┐
│  Git CLI (spawned)                                           │
│  PAT embedded in URL: https://x-access-token:PAT@host/...    │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ▼
                    Your team's repo
                    (~/.gitteam-data/ on disk)
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

## Project layout

```
src/                   React frontend
  components/          UI components (tickets, setup, conflicts, layout, ui primitives)
  lib/                 Tauri command wrappers, markdown utils, toast bus
  store/               Zustand store
  types/               TypeScript types
src-tauri/             Rust backend
  src/lib.rs           All 25 Tauri commands
  capabilities/        Tauri 2 permission scopes
odd/tasks/             Feature document (this project's source of truth)
```

See `odd/tasks/gitteam-app.md` for the full architecture plan, decisions, and progress log.

## Security model

- **PAT**: stored in OS keyring via the `keyring` crate. Service name `gitteam`, user `github-pat`. Never written to disk, never logged, never sent to JS.
- **Config file**: `~/.gitteam-config.json` (NOT in the data repo). Contains only repo URL, git user name/email, last sync timestamp. PAT is never in this file.
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
```

## Roadmap

This project shipped its 4-phase plan (local MVP, Git sync, acceleration, conflict resolution). Not in scope:

- Real-time collaboration (CRDT/Yjs)
- Mobile clients
- Binary attachments
- Built-in time tracking
- Tests (deliberately deferred — not worth the setup cost for a single dev project; add when the codebase stabilizes)

## License

Pick one before going public. MIT recommended for AI-friendly tools.

## Acknowledgments

Built with [Tauri](https://tauri.app), [React](https://react.dev), [Vite](https://vitejs.dev), [Tailwind](https://tailwindcss.com), [Zustand](https://github.com/pmndrs/zustand), [gray-matter](https://github.com/jonschlinkert/gray-matter), [lucide-react](https://lucide.dev), and the [`keyring`](https://github.com/hwchen/keyring-rs) crate.
