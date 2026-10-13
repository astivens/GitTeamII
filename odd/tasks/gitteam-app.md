# GitTeam — Gestor de Tickets Optimizado para IA

## Objetivo

Construir una app de escritorio (Tauri + React + TS) para gestionar tickets/tareas con archivos Markdown locales, sincronizados vía Git contra un repo privado del equipo. Cero servidores propios, AI-friendly, "Git invisible" para el usuario final.

## Problema

Los equipos chicos/remotos que usan IA necesitan compartir contexto estructurado entre humanos y modelos. Las herramientas existentes (Jira, Linear, Notion) o son caras o no son AI-friendly: el contenido vive en una DB opaca, no se puede copiar crudo, no se versiona, no se audita.

## Por qué este enfoque

- **Markdown plano**: el mismo archivo lo lee la UI, lo commitea Git, lo copia el usuario al prompt, lo abre en cualquier editor.
- **Git como DB**: gratis, distribuido, con merge nativo, historia completa, sync P2P posible.
- **Tauri sobre Electron**: ~10x menos RAM, binario chico, Rust para I/O de archivos.
- **Optimistic UI + sync eventual**: la experiencia es Trello/Linear, no un cliente de Git.

## Scope (lo que SÍ)

- App desktop Linux/macOS/Windows
- Tickets como `.md` con frontmatter YAML
- CRUD local con sync Git (clone, add, commit, push, pull)
- Detección de cambios remotos vía `ls-remote` cada 15s
- Auto-push con debounce de 2s, auto-pull onFocus
- UI optimista con toasts sutiles
- Resolución de conflictos (mostrar local vs remoto)
- Botón "Copiar para IA" (raw markdown al portapapeles)
- Config inicial: URL del repo + PAT

## Out of scope (lo que NO)

- Edición multi-user en tiempo real (CRDT/Yjs)
- Notificaciones push
- Comentarios en tickets (por ahora; el cuerpo del .md soporta cualquier markdown)
- Adjuntos binarios
- Mobile

## Restricciones

- **Linux primario** (este dev usa Arch), pero cross-platform desde el día 1
- **No telemetry, no analytics, no llamadas externas** fuera del repo configurado
- **PAT se guarda en el keyring del SO** (Tauri stronghold plugin), no en disco plano
- **Performance**: la app debe usar <150MB RAM en idle

## Stack

| Capa | Elección | Por qué |
|------|----------|---------|
| Shell desktop | Tauri 2.x | Bajo consumo, Rust typed |
| UI | React 18 + Vite | HMR rápido, ecosistema |
| Lenguaje UI | TypeScript strict | Frontmatter = data estructurada; bugs de tipo = tickets corruptos |
| Estilos | Tailwind CSS 3 | Iteración rápida, sin CSS global |
| Estado | Zustand | Simple, sin boilerplate, <1KB |
| Frontmatter | `gray-matter` | Estándar de facto |
| Iconos | `lucide-react` | Tree-shakeable, consistentes |
| Markdown render | `react-markdown` + `remark-gfm` | Para preview del cuerpo del ticket |
| Git CLI | `git2-rs` vía `tauri-plugin-git` o spawn | TBD en Fase 2 |
| Keyring | `tauri-plugin-stronghold` o `keyring` crate | PAT seguro |

## Convenciones

- **Tickets**: kebab-case-id, ej. `TKT-1042-update-csv-parser.md`
- **Frontmatter**: snake_case en keys, ISO 8601 para fechas
- **Status**: `backlog` | `in-progress` | `review` | `done` | `archived`
- **Priority**: `low` | `medium` | `high` | `urgent`
- **Commits**: Conventional Commits (sin co-authored-by, sin atribución de IA)
- **Branches**: `main` para el código; el repo de tickets no usa branches (todos en main, cada ticket es un commit)

## TDD

- **Strict TDD off** por ahora (proyecto nuevo, no hay suite configurada)
- Se agregan tests unitarios para el parser frontmatter (riesgo de corrupción de datos)
- Se agregan tests E2E (Playwright + Tauri driver) cuando haya UI madura en Fase 2/3

## Decisiones de arquitectura

### ¿Por qué archivos individuales y no un solo JSON?

Un JSON grande = un merge conflict por cambio. Archivos individuales = merge por ticket, mucho más fácil de resolver.

### ¿Por qué frontmatter y no DB tipo SQLite?

El frontmatter ES metadata estructurada visible para humanos y para IA. SQLite vive en un binario opaco, rompe el principio de AI-friendly.

### ¿Por qué no usar `tauri-plugin-git` directo?

Vamos a evaluar en Fase 2.1. Si `git2-rs` da problemas con la autenticación HTTPS+PAT, spawneamos `git` CLI (más predecible, maneja credenciales nativo).

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| PAT filtrado | Keyring del SO, nunca a disco plano |
| Conflictos en merge | UI de resolución, fallback a manual |
| `ls-remote` constante satura red | Solo hash de HEAD, ~50 bytes por request |
| Sync lento en push | Optimistic UI: la UI no espera |
| Corrupción de .md | Parser estricto, validación de frontmatter, recovery desde último commit |

## Acceptance Criteria (Fase 1)

- [x] `pnpm tauri dev` levanta la app ✅
- [x] Crear un ticket desde la UI genera un `.md` válido en el data folder ✅
- [x] Editar y guardar actualiza el archivo en disco ✅
- [x] El frontmatter se parsea a objeto TS y se vuelve a serializar sin perder campos ✅
- [x] "Copiar para IA" copia el markdown crudo al portapapeles ✅
- [x] La UI se ve limpia estilo Trello/Linear (dark mode primero) ✅

## Progress

### Fase 1 — Local MVP ✅ done (2026-10-13)

Commits:
- `chore: scaffold tauri 2 + react 19 + ts + vite + tailwind`
- `feat(core): markdown ticket backend and store`
- `feat(ui): kanban board, ticket cards, modal, copy-for-IA`
- `feat(ui): add toast event bus`

Verificación:
- `pnpm exec tsc --noEmit` → pass
- `pnpm exec vite build` → 238KB JS / 14KB CSS, 472ms
- `cargo check` (src-tauri) → pass
- `cargo build` (src-tauri, full) → pass, 1m 26s
- `pnpm tauri dev` → arrancó, creó `~/.gitteam-data/tickets/`, mató limpio

Implementado:
- 6 Tauri commands (init/list/read/create/update/delete) sobre `~/.gitteam-data/tickets/`
- Frontmatter YAML roundtrip via `gray_matter`, atomic write (tmp+rename)
- Filename: `{id}-{slug}.md` con collision suffix; ID autoincremental desde max(N)+1 (base 1000)
- Zustand store con optimistic state y refresh post-mutation
- Kanban 4-columnas (Backlog, In Progress, Review, Done; Archived en filtro)
- Modal crear/editar/borrar con validación (title required)
- "Copiar para IA" → raw markdown al portapapeles vía `tauri-plugin-clipboard-manager`
- Toast bus (pub/sub minimal), dark Linear-style
- Toasts, empty state, loading spinner, error retry

Notas:
- `gray_matter` crate usa underscore en Rust, no `gray-matter` (corrección del writer)
- I/O de archivos en Rust (sin scope de fs en capabilities — más seguro)
- El writer notó un bug del scaffold: `main.rs` referenciaba `tmpgitteam_scaffold_lib` → arreglado a `gitteam_lib`

### Fase 2 — Git sync ⏳ in progress

Decisiones tomadas:
- PAT storage: `keyring` crate → OS keyring (service "gitteam", user "github-pat")
- Git impl: spawn a `git` CLI (predecible, HTTPS+PAT vía URL embebida)
- Setup flow: full-screen en primer launch

Tareas:
- 2.0 Setup screen con URL + PAT + git name/email
- 2.1 Tauri commands: clone, pull, push, commit, status, test_connection
- 2.2 Header sync indicator + botón Sync manual + error handling
- 2.3 Wire ticket changes → commit+push; restructure data dir a `~/.gitteam-data/` root

## Tareas (referencian los todos)

Ver `todowrite` activo. Fases 1.0 → 1.5 son el MVP local sin Git (puede usarse de forma "offline first"). Fases 2+ agregan sincronización.

## Notas para el futuro

- Fase 2.1: evaluar `tauri-plugin-git` vs spawn a `git` CLI
- Fase 3.2: considerar `sonner` para toasts (más bonito que `react-hot-toast`)
- Fase 4.0: la resolución de conflictos puede ser tonta (mostrar diff y dejar elegir) — no necesitamos un merge editor de 3 paneles

### Fase 3 — Sync invisible (background ls-remote + debounce + onFocus) ✅ done (2026-10-13)

Implementado:
- Worker `git ls-remote` cada 15s en Tokio, emite evento `remote-changed` cuando cambia el SHA de HEAD remoto
- Auto-push con debounce de 2s en el store: cada commit de ticket se acumula y se flushea junto
- Auto-pull onFocus: si está synced y no hay commits pendientes, hace `gitPull` automáticamente
- Header `AppHeader` muestra indicador de sync (synced/syncing/error/conflict)
- `syncNow` (botón manual) → pull + commit+push de archivos locales + refresh de tickets
- Manejo de errores: REJECTED (push no-fast-forward) y CONFLICT (pull con conflictos) → `syncStatus = 'conflict'`
- Watcher inicia/para junto con el ciclo de vida del repo conectado

Notas:
- En este proyecto NO se hace cross-compile. Cada plataforma se construye en su propio OS (ver Build en Fase 4).

### Fase 4 — Conflict resolution UI + build docs ✅ done (2026-10-13)

Implementado:
- 5 nuevos Tauri commands: `git_list_conflicts`, `git_read_conflict_version`, `git_resolve_conflict`, `git_finish_resolution`, `git_abort_resolution`
- Strategy per-file: `git checkout --ours/--theirs <file>` + `git add <file>`. "Both" guarda el HEAD como `<file>.remote.md` con collision suffix (-2, -3 ...)
- Store actions: `loadConflicts`, `resolveConflict`, `finishResolution`, `abortResolution`. Auto-finaliza cuando `conflicts.length === 0`
- `syncNow` ahora dispara `loadConflicts()` cuando entra a estado conflict
- UI: `ConflictBanner` (top bar) + `ConflictModal` (lista + vista side-by-side con `react-markdown`)
- Modal usa `Modal` con prop `wide` (max-w 1100px en lugar de 720) para acomodar el preview
- Scripts de build cross-platform documentados (no cross-compile real — el usuario compila en cada OS)

### Build

GitTeam NO cross-compila. El binario debe producirse en el sistema operativo destino porque cada plataforma necesita sus propias native dependencies (webkit2gtk en Linux, WebKit en macOS, WebView2 en Windows). Ver docs oficiales de Tauri: <https://v2.tauri.app/start/prerequisites/>.

Scripts disponibles (definidos en `package.json`):

- `pnpm build:linux` — produce un `.AppImage` portable en `src-tauri/target/release/bundle/appimage/`. **Este dev usa Arch como primary**, así que este es el script que corre normalmente. Requiere `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`, `openssl` y `gcc` instalados (ver Tauri prerequisites para la lista exacta).
- `pnpm build:macos` — produce un `.app` y un `.dmg` en `src-tauri/target/release/bundle/macos/`. **Debe correrse en macOS** (requiere Xcode CLI tools). Para ARM (M1/M2/M3) usa `--target aarch64-apple-darwin`; para Intel usa `--target x86_64-apple-darwin`. Para universal binary: `--target universal-apple-darwin`.
- `pnpm build:windows` — produce instaladores NSIS (`.exe`) y MSI en `src-tauri/target/release/bundle/nsis/` y `bundle/msi/`. **Debe correrse en Windows** (requiere WebView2 runtime y Visual Studio Build Tools con workload C++).
- `pnpm build:dev` — `tauri build --debug`: build rápido sin bundling, útil para iterar cuando solo se quiere probar el binario. Output en `src-tauri/target/debug/`.

El `.AppImage` es portable — corre en cualquier Linux moderno sin instalación, solo necesita permisos de ejecución (`chmod +x file.AppImage`).

Workflow típico en Linux (este dev):
1. `pnpm install` (si no se corrió)
2. `pnpm build:linux`
3. Output → `src-tauri/target/release/bundle/appimage/GitTeam_0.1.0_amd64.AppImage`
4. Mover el `.AppImage` a donde se quiera (USB, release, etc.)

Para testing local sin empaquetar:
- `pnpm tauri dev` — dev server con HMR
- `pnpm build:dev` — binario debug standalone sin instalador

Notes:
- El script `build` (frontend only: `tsc && vite build`) sigue existiendo y es independiente de los scripts de build de Tauri.
- Los builds de Tauri son lentos en frío (1-2 min para incremental, 5-10 min para release limpio). El usuario debe correrlos — el orchestrator no compila binarios.
