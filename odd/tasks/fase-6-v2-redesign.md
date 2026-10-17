# Fase 6 — v2 redesign, multi-project y graph

Objetivo: llevar el visual de OpenPencil al código (sin Tailwind, con tokens CSS themeables), sumar identity/motion, multi-project y el graph de tickets.
Branch: `fase-6-v2-redesign` · Delivery: `ask-on-risk` (todavía sin push ni PR) · Checks: `cargo test` + `cargo check` (src-tauri) y `pnpm build` (tsc && vite build).

## Specs

Los `S#` son el contrato. Donde el texto original del pedido está disponible se cita **verbatim**; el resto quedó de la sesión anterior y se marca como paráfrasis (el texto original no está disponible en este contexto). No se agregaron requisitos que el usuario no pidió.

- **S1 — Sin Tailwind, con tokens CSS themeables.** Reemplazar Tailwind por CSS custom properties; themes por `[data-theme]`. Paráfrasis de la sesión anterior.
  Verificación: `tailwind.config.js` eliminado, no quedan clases Tailwind en los componentes, `pnpm build` pasa.
- **S2 — Identity con personalidad pero "familiar".** Brand lockup (monograma + wordmark), avatar violeta, empty states con carácter. Paráfrasis de la sesión anterior.
  Verificación: `BrandLockup` renderizado en `AppHeader`; 4 variantes de empty state con copy propio.
- **S3 — Rituales de teclado y motion.** Copy rápido del TKT ID (botón + atajo), sync dot pulse, new ticket glow. Paráfrasis de la sesión anterior.
  Verificación: `Y` copia el último ticket visto y muestra confirmación; `sync-pulse` corre mientras sincroniza.
- **S4 — Multi-project storage.** Un directorio por proyecto, con su propio data dir y credenciales; legacy intacto. Paráfrasis de la sesión anterior.
  Verificación: `list_projects`, `get_active_project`, `add_project`, `remove_project`, `switch_project`; `data_dir()` rutea al proyecto activo y cae al legacy `~/.gitteam-data` si no hay ninguno.
- **S5 — Multi-project UI.** Switcher en el header con estado de sync por proyecto y CTA para linkear un repo nuevo. Paráfrasis de la sesión anterior.
  Verificación: `ProjectSwitcher` lista proyectos, resalta el actual y emite `gitteam:link-new-repo`.
- **S6 — (bug) Linkear un repo nuevo tiene que funcionar.** Cita verbatim del reporte: *"cuando uso la opción para agregar un nuevo repo, no funciona"*.
  Verificación: `add_project` clona el repo remoto y el proyecto queda usable; rollback si falla.
- **S7 — Graph backend.** Links entre tickets en el frontmatter: `links: [TKT-1041, TKT-1039]`. Paráfrasis de la sesión anterior.
  Verificación: `link_tickets`, `unlink_tickets`, `get_graph`; round-trip del frontmatter cubierto por tests.
- **S8 — Graph UI estilo Obsidian.** Force-directed, arrastrable, click en nodo abre el ticket. Paráfrasis de la sesión anterior.
  Verificación: vista Graph renderiza nodos/edges, hover resalta vecinos, drag mueve, click abre el ticket.

## Tasks

| ID | S# | Trabajo | Ruta | Estado | Commit |
|----|----|---------|------|--------|--------|
| T1 | S1 | Tailwind out + tokens/theme/keyframes | inline | hecho | `be76e8a` |
| T2 | S2 | Brand lockup, empty states, yank button, `CopyForAIButton compact` | inline | hecho | `9c7bc73` |
| T3 | S3 | sync pulse, atajo `Y`, `lastViewedId` | inline | hecho | `a3d184a`, `d9c8dc8` |
| T4 | S4 | Backend multi-project + `data_dir()` inteligente | inline | hecho | `9178648` |
| T5 | S5 | `ProjectSwitcher` + `NoProjectEmptyState` | inline | hecho | `f9f413b` |
| T6 | S6 | **Fix add repo**: clonado real, keyring por proyecto, layout `<project>/repo` | inline | hecho | `52709ca` |
| T7 | S7 | `links` en frontmatter + `link_tickets`/`unlink_tickets`/`get_graph` | inline | hecho | `31d19d1` |
| T8 | S7 | Extraer `build_edges` + tests de edges | inline | hecho | `e865816` |
| T9 | S8 | `GraphView` + toggle Board/Graph + editor de links en el modal | inline | hecho | `8168f16` |
| T10 | S7 | Tests de `link_in_dir`/`unlink_in_dir` sobre archivos | inline | hecho | `fd05e12` |
| T11 | S1–S8 | Actualizar feature doc y README | inline | hecho | `576f7a2`, `aea4e09` |
| T12 | S1 | Toggle de tema en la UI (`data-theme`) | — | **pendiente** | — |

Ruta: todas las tareas se hicieron inline. No se disparó el trigger de Writer (no hubo unidades paralelas independientes ni backstop de contexto), ni el de verificación independiente (no hay ítem de alto riesgo nuevo con verificación independiente pendiente; ver `Risk` abajo).

## Riesgos

- **Frontmatter es dato persistido** (ítem 1): cambiar el render podía reescribir cualquier ticket. Mitigado con `links` emitido **solo cuando no está vacío** y tests de no-regresión para el caso sin links y para archivos legacy.
- **Credenciales** (ítem 2): el service name del keyring cambió de `gitteam` a `gitteam/<id>` por proyecto. La ruta legacy (sin proyecto activo) sigue usando `gitteam`.
- **Contrato de comandos** (ítem 3): se **agregaron** `link_tickets`/`unlink_tickets`/`get_graph` y el campo `links` en `Ticket`; no se removió ni rompió nada existente.

## Gaps conocidos

- **Toggle de tema**: los tokens `[data-theme="default"|"light"|"obsidian"]` existen y están listos, pero **nada setea `data-theme` todavía**. El criterio "Light theme funcional" está a medias: falta la UI (issue P1-13 del audit). No se implementó acá porque no fue pedido en esta sesión.
- **Sync state por proyecto**: `syncStatus` sigue siendo global, no por proyecto.
- **Cursor blink en el editor markdown**: necesita un contenteditable propio; diferido.
- **`G L`/`G K`/`G A`**: las vistas List/Analytics no existen. Se implementó `g k` (board) y `g g` (graph) — desvío deliberado y honesto respecto del plan original.
- **`dataDir` en el store**: quedó como campo muerto (nadie lo lee); candidato a limpieza.

## Log

- **L1** — Pedido original de la sesión anterior (texto verbatim no disponible en este contexto): rediseño v2 de GitTeam con base de diseño en OpenPencil, sin Tailwind, con personalidad pero familiar; copy rápido de TKT IDs, multi-project, graph estilo Obsidian, y eventualmente themes creados por el usuario.
- **L2 (2026-10-17)** — Reporte verbatim: *"cuando uso la opción para agregar un nuevo repo, no funciona"*.
  Diagnóstico: `add_project` sólo creaba el directorio y escribía metadata — **nunca clonaba el repo**. Además el PAT se guardaba en `gitteam/<id>` pero `load_pat()` leía `gitteam`, así que `git_pull`/`git_push`/el watcher no lo encontraban. Y `data_dir()`/`config_path()` exigían que `config.json` ya existiera, por lo que la **primera** escritura de `add_project` se iba a las rutas legacy. Resuelto en T6.
  Decisión de diseño: el checkout vive en `<project_dir>/repo` y `config.json` al lado, no adentro — así `config.json` no deja el repo del usuario permanentemente sucio.
- **L3 (2026-10-17)** — Evidencia de la corrección: `git clone <url> <dir-vacío-preexistente>` funciona y deja el árbol limpio (verificado con un repo bare temporal); `cargo check` limpio; `pnpm build` OK.
- **L4 (2026-10-17)** — Pedido: continuar con el grafo. Implementado T7–T10.
  Decisión: force layout propio (repulsión + resortes + centrado + anillo para nodos sin links) en vez de sumar `d3-force`. Los grafos acá son de decenas de tickets y el proyecto es dependency-light.
  Decisión: los links son **declaración del ticket origen** (como un `[[wiki-link]]` de Obsidian) y el graph colapsa `A→B` y `B→A` en una sola arista. `link_tickets` exige que el destino exista para no inventar nodos fantasma.
  Decisión: los links se escriben **solo** por `link_tickets`/`unlink_tickets`; `update_ticket` siempre los preserva, así una edición normal nunca los borra.
- **L5 (2026-10-17)** — Un test encontró una suposición mía incorrecta: `Matter::parse` recorta el `\n` final del body. El comportamiento del código era correcto; la aserción estaba mal y se corrigió.
- **L6 (2026-10-17)** — Riesgo evitado: hacer que el prop `ticket` del modal se re-derive del store en cada render (para que los links se vieran en vivo) hacía que el `useEffect` re-sembrara el formulario ante cualquier refresh y **descartara ediciones en curso**. Se cambió para re-sembrar solo al abrir o cuando cambia el id del ticket.
- **L7 (2026-10-17)** — Delivery: la rama acumula ~4025 inserciones / ~1005 borrados, muy por encima de las ~400 líneas. No hay push ni PR. Cuando el usuario quiera publicar, corresponde aplicar la estrategia de entrega elegida (proponer el corte en PRs encadenados) — es una decisión del humano bajo política ordinaria del repo.

## Criterios de aceptación

- [x] Tailwind removido completamente
- [x] CSS custom properties definidas y themeables vía `[data-theme]`
- [ ] Light theme **activable** desde la UI — tokens listos, toggle pendiente (T12)
- [x] Brand "gitteam" + monograma visible en el header
- [x] Copy de TKT IDs con feedback (botón Y en la tarjeta + atajo global `Y`)
- [x] Motion signatures (sync pulse, new ticket glow)
- [x] Empty states con copy con carácter
- [x] Multi-project: listar, switch y agregar proyectos funciona
- [x] Graph: los links entre tickets se renderizan
- [x] Atajos de vista `g k` / `g g` (reemplazan a `g l`/`g k`/`g a`, que apuntaban a vistas inexistentes)
- [x] `tsc --noEmit` pasa
- [x] `pnpm build` pasa
- [x] `cargo test` pasa (13 tests)

## Related

- Design System en OpenPencil: tab-1 page `611929921:17`
- Memory: topic `design-system-v2` (decisiones de diseño), topic `fase-6-v2-redesign` (implementación)
- `ui-ux-audit.md`: P0-3 (side panel), P1-9 (markdown preview), P1-13 (theme toggle — abierto)
