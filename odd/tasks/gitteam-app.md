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

- [ ] `pnpm tauri dev` levanta la app
- [ ] Crear un ticket desde la UI genera un `.md` válido en el data folder
- [ ] Editar y guardar actualiza el archivo en disco
- [ ] El frontmatter se parsea a objeto TS y se vuelve a serializar sin perder campos
- [ ] "Copiar para IA" copia el markdown crudo al portapapeles
- [ ] La UI se ve limpia estilo Trello/Linear (dark mode primero)

## Tareas (referencian los todos)

Ver `todowrite` activo. Fases 1.0 → 1.5 son el MVP local sin Git (puede usarse de forma "offline first"). Fases 2+ agregan sincronización.

## Notas para el futuro

- Fase 2.1: evaluar `tauri-plugin-git` vs spawn a `git` CLI
- Fase 3.2: considerar `sonner` para toasts (más bonito que `react-hot-toast`)
- Fase 4.0: la resolución de conflictos puede ser tonta (mostrar diff y dejar elegir) — no necesitamos un merge editor de 3 paneles
