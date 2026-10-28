# GitTeam

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows-7c5cff)](#building-a-distributable)

**English** · [Español](README.es.md)

GitTeam is a free, local-first ticket manager where **every ticket is a Markdown file inside a Git repository you own**. There is no server to run, no account to create and no vendor database. A team collaborates by sharing that repository, asynchronously — the same way it shares code.

---

## Table of contents

- [Why another ticket tracker](#why-another-ticket-tracker)
- [Features](#features)
- [How collaboration works](#how-collaboration-works)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Using the app](#using-the-app)
- [Where your data lives](#where-your-data-lives)
- [Ticket file format](#ticket-file-format)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Building a distributable](#building-a-distributable)
- [Development](#development)
- [Project structure](#project-structure)
- [Not in scope](#not-in-scope)
- [Acknowledgments](#acknowledgments)

## Why another ticket tracker

Most ticket tools are opaque databases behind a service. You cannot `grep` a ticket, diff it, review it or hand it to an AI assistant without losing context, and you cannot take your data with you.

GitTeam inverts that:

- **The ticket is the file.** YAML frontmatter plus a Markdown body. The board is a view of that file, not a record in a database.
- **The sync layer is Git.** History, blame, pull requests, backups and access control come from the remote you already use.
- **There is nothing to host.** The app is a desktop binary; the shared state is a repository.
- **AI gets the same bytes you see.** *Copy for AI* copies the raw Markdown, with no transformation.

## Features

| | |
|---|---|
| **Tickets as Markdown** | Frontmatter (id, status, assignee, priority, tags, links) plus a free-form body. The same file in the app, in your editor, in Git and in a prompt. |
| **Kanban board and graph** | A board grouped by status, and an Obsidian-style force graph of the `links:` between tickets. Hover highlights neighbours, drag moves a node, click opens the ticket. |
| **Keyboard first** | `⌘K` command palette, `N` new ticket, `Y` copy the last viewed ticket id, `G` `K` board / `G` `G` graph, `?` shortcut help. |
| **Copy for AI** | The copy button puts the raw Markdown of a ticket on the clipboard, ready to paste into any assistant. |
| **Local-first** | Full offline create/edit/delete. The network is used only to sync the repository. |
| **Automatic sync** | Edits are debounced, a background watcher polls the remote every 15 seconds, and focusing the window pulls pending changes. |
| **Conflict handling** | Ticket files are merged field by field by a custom Git merge driver. When a merge cannot be resolved, a side-by-side preview shows local vs. remote per file, with local / remote / both per file. |
| **Multi-project** | One local checkout and one credential entry per repository. Switch boards from the header. |
| **Share from the app** | Create a tickets repository, invite a collaborator by GitHub username, or copy an invitation link. |
| **Deep link** | `gitteam://join?…` opens the app on the join flow. |
| **Themes** | Three token sets — `default` (dark), `light` and `obsidian` — switchable from the header and remembered locally. |
| **Bilingual interface** | English and Spanish, switchable from the header, detected from your system language and remembered locally. Git and backend diagnostics stay in English. |
| **No telemetry** | No analytics and no outbound calls other than the Git remote you configured. |

## How collaboration works

A **board is a repository**. Sharing a board means sharing that repository:

1. **Create or connect a board.** The app can create a dedicated tickets repository through the GitHub API, or connect to an existing HTTPS remote. Tickets never live inside your code repository.
2. **Invite someone.** Add them as a collaborator by username, or send them an invitation link (`gitteam://join?repo=…&board=…&from=…`). The link is not a credential: it carries no token.
3. **Work offline, sync through Git.** Each side commits and pushes at its own pace; the other side pulls. Ticket files merge field by field, so two people editing different fields of the same ticket do not fight.

This is **asynchronous** collaboration by design. There is no presence, no cursor sharing and no real-time channel, because there is no server to provide one.

## Requirements

- **Node.js** `^20.19.0` or `>=22.12.0` (required by Vite 8)
- **pnpm** 9 or newer (the repository ships a `pnpm-lock.yaml`)
- **Rust** 1.85 or newer (the crate uses edition 2024) with Cargo
- **Git** in `PATH`
- **CMake and a C toolchain** — the HTTP client uses `rustls` with `aws-lc-rs`, which compiles native code. No system OpenSSL is needed.

Linux also needs the Tauri 2 system libraries:

```bash
# Debian / Ubuntu
sudo apt install build-essential pkg-config cmake libwebkit2gtk-4.1-dev \
  libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev \
  libxdo-dev libssl-dev

# Arch Linux
sudo pacman -S --needed base-devel pkgconf cmake webkit2gtk-4.1 gtk3 \
  libsoup3 librsvg libayatana-appindicator libxdo openssl
```

macOS needs Xcode Command Line Tools. Windows needs the MSVC build tools and WebView2 (preinstalled on current Windows).

## Getting started

```bash
git clone https://github.com/astivens/GitTeamII.git
cd GitTeamII
pnpm install
pnpm tauri dev
```

The first launch shows the setup screen, which asks for two things:

- a **repository** — either an HTTPS remote you already have, or the name of a new tickets repository to create;
- a **GitHub personal access token** (classic, `repo` scope) — used for the GitHub API (creating boards, inviting collaborators) and for private repositories. The token is stored in the operating system keyring and never written to disk.

Once connected, press `N` to create your first ticket.

## Using the app

| Action | How |
|---|---|
| Create a ticket | `N`, or the **New ticket** button |
| Search / navigate / sync | `⌘K` (or `Ctrl+K`) |
| Copy a ticket id | Open a ticket and press `Y` (copies the last viewed id) |
| Copy a ticket for an AI assistant | **Copy for AI** inside the ticket |
| Change language | The **EN / ES** switch in the header |
| Switch between board and graph | The **Board / Graph** toggle in the header, or `G` `K` / `G` `G` |
| Change theme | The three theme buttons in the header |
| Switch board | The project menu in the header |
| Sync now | The sync button in the header (*Sync now*); edits also sync on their own |

Ticket ids are short (`TKT-1042`) so they are cheap to paste into a commit message, a chat or a prompt.

## Where your data lives

```
~/.gitteam/
  .active                      id of the active project
  projects/
    <project-id>/
      config.json              remote URL, git user name/email, last sync (never the token)
      repo/                    the Git checkout — the ticket .md files live here
```

One directory per repository, so projects never share a checkout or a credential. `project-id` is derived from the repository name (lowercased, with `-2`, `-3` appended on collision). The token for a project lives in the OS keyring under the service `gitteam/<project-id>`.

If no multi-project entry exists, the app falls back to the original single-project layout (`~/.gitteam-data/` and `~/.gitteam-config.json`), so earlier setups keep working.

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
- Detect the encoding before processing
- Keep the algorithmic complexity at O(n)
```

Filenames follow `{id}-{slug}.md`, for example `TKT-1042-update-csv-parser-for-utf-16.md`. Ids start at `TKT-1000`.

`links` is optional and is only written once a ticket has links, so existing files are never rewritten to add an empty key. A link points at another ticket's id; the graph draws one undirected edge per linked pair, so `A → B` and `B → A` are a single edge. Links to tickets that do not exist are ignored.

Markdown files in the checkout without frontmatter (a `README.md`, notes, an `AGENTS.md`) are not tickets and are skipped.

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript + Vite                                │
│  Zustand store · react-markdown · cmdk · plain CSS tokens    │
└─────────────────────────────┬────────────────────────────────┘
                              │ invoke() over Tauri IPC
┌─────────────────────────────┴────────────────────────────────┐
│  Rust backend (Tauri 2) — 40 commands                        │
│  tickets · git · conflicts · graph · boards · invitations    │
│  keyring for credentials · tokio for subprocesses            │
└─────────────────────────────┬────────────────────────────────┘
                              │ std::process::Command
┌─────────────────────────────┴────────────────────────────────┐
│  Git CLI                                                     │
│  credential injected per command, never persisted            │
└─────────────────────────────┬────────────────────────────────┘
                              │ HTTPS
                              ▼
                    the shared tickets repository
```

The frontend never touches the filesystem: every read and write goes through a Rust command, so no `fs` permission is exposed to JavaScript.

## Security model

- **Token storage.** The personal access token lives in the OS keyring (Linux Secret Service, macOS Keychain, Windows Credential Manager) under `gitteam/<project-id>`. It is never written to a file, logged, or sent to the frontend. On Linux the keyring is backed by the Secret Service (GNOME Keyring or KWallet) with keyutils as a cache, so the credential survives a logout: plain keyutils storage is session-scoped and its persistent link is revoked after `persistent_keyring_expiry` (three days by default), which is how a saved token can silently disappear. The Secret Service keeps its own encrypted database on disk — that store, not GitTeam, owns the at-rest copy.
- **Token use.** It is injected per Git command through a command-scoped `url.<credentialed>.insteadOf=<clean>` override. The configured remote stays clean, so the credential is not stored in the checkout's `.git/config` and does not survive the command.
- **Config file.** `config.json` sits next to the checkout, contains only the remote URL, the Git identity and the last sync time, and never the token.
- **Redaction.** Git's output is scrubbed before it reaches a message, so a credential in a failing command cannot surface on screen.
- **No telemetry.** The only outbound traffic is to the Git remote you configured and, when you ask for it, the GitHub API.

## Building a distributable

| Target | Command | Output |
|---|---|---|
| Linux | `pnpm build:linux` | `.AppImage` |
| macOS | `pnpm build:macos` | `.app` + `.dmg` |
| Windows | `pnpm build:windows` | NSIS + MSI installers |
| Any (no bundling) | `pnpm build:dev` | Debug binary, faster to iterate |

Each target must be built on its own platform.

## Development

On Linux, storing the token needs a running Secret Service — GNOME Keyring or KWallet — and building links against `libdbus` (`apt install libdbus-1-dev` when the headers are missing).
```bash
pnpm tauri dev              # hot-reloading desktop app
pnpm exec tsc --noEmit      # type check
pnpm build                  # type check + production frontend build
pnpm test:e2e               # Playwright: UI flows against a faked Tauri IPC boundary
cd src-tauri && cargo test  # 97 unit tests + 2 integration tests
```

The Rust suite covers frontmatter round-tripping, link handling, graph edges, the merge driver and the credential handling. The E2E suite runs the real React app in headless Chromium; only the Tauri IPC boundary is faked (`e2e/fixtures/tauri-mock.ts`), so it covers the interface — boards, ticket CRUD, sync states — and not the Rust commands, which `cargo test` covers. Run `pnpm exec playwright install chromium` once per machine.

## Project structure

```text
src/                    React frontend
  components/           board, graph, setup, conflicts, layout, UI primitives
  lib/                  Tauri command wrappers, theme, shortcuts, toasts
  store/                Zustand store
  types/                TypeScript types
src-tauri/              Rust backend
  src/lib.rs            Tauri commands, git integration and the test suite
  src/main.rs           Binary entry point (also hosts the merge driver)
  capabilities/         Tauri 2 permission scopes
  icons/                App icons, generated from the brand mark
public/                 Static assets
e2e/                    Playwright suite: UI flows against a faked Tauri IPC
```

## Not in scope

- Real-time collaboration (CRDT / Yjs) — the sync model is Git and it is asynchronous on purpose.
- Mobile clients.
- Binary attachments.
- Time tracking.
- A frontend test runner for component internals: the interface is covered by the Playwright E2E suite in `e2e/`, which fakes the Tauri IPC boundary, and the Rust backend has a `cargo test` suite.

## Acknowledgments

Built with [Tauri](https://tauri.app), [React](https://react.dev), [Vite](https://vitejs.dev), [Zustand](https://github.com/pmndrs/zustand), [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm), [cmdk](https://cmdk.paco.me), [lucide-react](https://lucide.dev) and the [`keyring`](https://github.com/open-source-cooperative/keyring-rs) crate.

The UI is plain CSS driven by custom properties — no CSS framework. Ticket links follow the `[[wiki-link]]` idea from [Obsidian](https://obsidian.md), which also inspired the graph view.
