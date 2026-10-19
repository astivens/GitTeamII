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
| T12 | S1 | Toggle de tema en la UI (`data-theme`) | inline | hecho | `c055af4` |
| T13 | S6 | **Fix sync destructivo**: GitTeam nunca commitea/pushea archivos que no son tickets; timeouts realistas; rechazo de checkouts incompletos | inline | hecho | (este commit) |

Ruta: todas las tareas se hicieron inline. No se disparó el trigger de Writer (no hubo unidades paralelas independientes ni backstop de contexto), ni el de verificación independiente (no hay ítem de alto riesgo nuevo con verificación independiente pendiente; ver `Risk` abajo).

## Delivery (cadena de PRs)

Estrategia elegida con la decisión delegada por el usuario (`"Como gustes"`): **Stacked PRs to main**, en 8 slices. La historia es lineal y compartida, así que cada slice es un branch apuntando a su último commit y el diff de cada PR es exactamente un slice — sin rebase, sin reescritura, sin diffs contaminados. Se mergea **en orden y con merge commit** (nunca squash: el squash haría reaparecer los commits del slice anterior en el diff del siguiente).

| # | Rama | Base | Commits | Líneas (+/−) | Boundary |
|---|------|------|---------|--------------|----------|
| 1 | `feat/01-design-system-v2` | `main` | 5 (`876d2c8`→`d9c8dc8`) | 1516+901 = 2417 | cargo test OK · tsc OK |
| 2 | `feat/02-multi-project` | `feat/01-…` | 4 (`9178648`→`52709ca`) | 1104+104 = 1208 | cargo test OK · tsc OK |
| 3 | `feat/03-ticket-graph` | `feat/02-…` | 6 (`31d19d1`→`58fa26d`) | 1552+149 = 1701 | cargo test OK (13) · tsc OK |
| 4 | `feat/04-sync-ownership` | `feat/03-…` | 1 (`6baefef`) | 245+25 = **270** | cargo test OK (17) · tsc OK |
| 5 | `feat/05-tickets-dir-seam` | `feat/04-…` | 2 (`998c011`, `06b5c04`) | 150+28 = **178** | cargo test OK (17) · tsc OK |
| 6 | `feat/06-ticket-identity` | `feat/05-…` | 2 (`ec01beb`, `d080b63`) | 658+16 = 674 | cargo test OK (29) · tsc OK |
| 7 | `feat/07-merge-driver` | `feat/06-…` | 4 (`dbc7e37`→`fc7a2e4`) | 1063+19 = 1082 | cargo test OK (42) · tsc OK |
| 8 | `feat/08-theme-hygiene` | `feat/07-…` | 3 (`d366726`→`d50ad25`) + el doc del corte (`52f969b`) | 130+6 = **136** (+26 de doc = 162) | cargo test OK (42) · tsc OK |

Verificación de boundaries: `cargo test` + `npx tsc --noEmit` sobre cada tip en un worktree aislado (con `main` como control) — **9/9 verdes**. Script: `/tmp/opencode/gitteam-chain-verify.sh`.

Overage honesto (una sola pasada de corte, como manda el skill `chained-pr`): los slices 1, 2, 3, 6 y 7 exceden el presupuesto de 400 líneas y **no hay corte cohesivo que los baje** — el slice 1 es un port mecánico de 24 archivos que no compila a medias, el 2 y el 3 son backend + la UI que lo consume, el 6 es la feature con su test de prueba y el 7 es un solo mecanismo. Recomendación: `size:exception` para esos cinco. Los slices 4, 5 y 8 entran en presupuesto.

Los bodies de los 8 PR (con el `## Chain Context` que pide el skill) están en `/tmp/opencode/gitteam-prs/`, y el script que publica todo —push de las 9 ramas + los 8 PR— en `/tmp/opencode/gitteam-prs/open-chain.sh`. **La cadena se publicó** el 2026-10-18 con autorización explícita del usuario: 8 PR abiertos en `astivens/GitTeamII` (#1 → #8), cada uno con su base en el PR anterior y el diagrama de dependencias cosido con los números reales. Mergear en orden y con merge commit.

### Review nativo (RDD) — slice 7, el merge driver

Candidato: `d080b63..fc7a2e4` (1082 líneas, 4 archivos). Es el **único** de los 8 slices con `review_due` (`high_risk`); con el worktree parado en el tip de cada slice, los slices 1–6 y 8 dieron `medium`/`under_budget`. Lentes: `risk`, `resilience`, `reliability` — el driver escribe el ticket mergeado, decide la degradación cuando un lado no parsea, y su política la tienen que fijar los tests.

Transacción: lineage `review-e1688d3581e64df5`, target `sha256:0a602cdb…`, 3 reviewers en paralelo (los tres con admisión `completed`), presupuesto de corrección **200 líneas sin usar** y **cero correcciones** (no hubo blockers). Veredicto: **approved**; el acknowledgement exacto quemó la autoridad (`gentle-ai.review-acknowledged/v1`, `authority: burned`). El boundary revisado queda en `fc7a2e4`.

Esto **no** es una aprobación de entrega: mergear y publicar siguen siendo política ordinaria del repo.

Findings — todos **informational / no bloqueantes**, quedan como trabajo posterior. Ninguno autoriza scope nuevo por sí solo:

| id | lente | dónde | sev | qué dice |
|----|-------|-------|-----|----------|
| R1-1 | risk | `lib.rs:1596-1598` | WARNING | el comando del driver se arma concatenando la ruta del ejecutable dentro de un string con comillas dobles que git después ejecuta por shell: las comillas dobles no neutralizan `$`, backticks ni `$(...)`, así que un binario instalado en una ruta con sintaxis de shell haría correr un comando sustituido con los privilegios del usuario, o rompería el driver en silencio. |
| R1-2 | risk | `main.rs:8-9`, `lib.rs:1647` | SUGGESTION | el subcomando `merge-driver` recibe tres paths del llamador y sobrescribe el segundo con el resultado: nada verifica que el target esté adentro del repo conectado o de `tickets_dir()` (el parseo limita qué archivos son alcanzables). |
| R4-1 | resilience | `lib.rs:1887-1893`, `1539-1541` | WARNING | el registro del driver es best-effort: los fallos van sólo a stderr y se ignoran, y en el GUI empaquetado stderr no llega a ninguna consola, así que el merge vuelve al de git sin que nadie se entere. Falta verificación post-registro de que la regla de attributes matchee algo. |
| R4-2 | resilience | `lib.rs:1661-1676`, `1814` | WARNING | si las dos puntas cambian el mismo campo escalar (status/title/priority) gana el `last_updated` más nuevo y el otro valor se descarta **sin registro** en ningún lado; el criterio de aceptación del plan (`multi-user-foundations.md:57-58`) pide que la elección sea determinística **y registrada**. Sólo los bodies dejan rastro visible. |
| R4-3 | resilience | `lib.rs:1795-1801` | SUGGESTION | si las dos puntas editaron el body y una edición es sólo whitespace, esa edición se pierde: la garantía de "los dos bodies sobreviven" queda acotada a líneas no vacías. |
| R3-001 | reliability | `lib.rs:1891-1893` | WARNING | el orden que la feature documenta como load-bearing (registrar el driver antes de cada pull) no está probado: sacar `ensure_merge_driver` de `git_pull` seguiría pasando la suite. |
| R3-002 | reliability | `lib.rs:1668-1674` | WARNING | el mismo ganador escalar silencioso de R4-2 visto desde reliability: un merge parseable pero equivocado no deja rastro para detectarlo ni revertirlo. |
| R3-003 | reliability | `lib.rs:1589`, `merge_driver_cli.rs` | SUGGESTION | la cobertura con git real sólo ejercita un ticket en la raíz del repo — justo el acoplamiento `MERGE_DRIVER_PATTERN` ↔ `tickets_dir()` que el propio código documenta como riesgo de fallo silencioso. |

### L9 decidido: los tickets viven en repos dedicados (2026-10-18)

Respuesta del usuario: **opción A**. Un proyecto de tickets apunta siempre a un repo de tickets; el repo de la app no participa.

Evidencia que hizo la decisión barata: el proyecto vivo (`~/.gitteam/projects/royero-labs`) apunta hoy a `astivens/Royero-Labs` —el repo de la app— y tiene **0 tickets**: 0 en el worktree, 0 trackeados, 0 commits con `TKT-*` en `origin/HEAD`. No hay nada que migrar: se re-apunta el proyecto a un repo de tickets y queda.

Consecuencias: (1) el motor **no cambia** — un proyecto ya es "un repo cuyo root tiene los tickets" y `tickets_dir()` sigue igual al root; (2) "tickets en un subdirectorio" queda como costura inactiva (`repo_root()`/`tickets_dir()` ya están separadas, con los tres cambios acoplados documentados en `multi-user-foundations.md`); (3) compartir un board pasa a ser "compartir el repo de tickets", sin código de la app de por medio.

### Seguridad: el PAT ya no queda en el disco (`d9e08f1`, `Risk: item 2`)

Hallazgo (reportado al usuario antes de tocar nada): `git clone <url-con-token>` y `git remote add origin <url-con-token>` persisten el token en `<clone>/.git/config` como `remote.origin.url`, y **todas** las rutas de red dependían de esa URL guardada, así que el token se escribía una vez y se usaba para siempre —en backups, en `git remote -v`, en cualquier copia del directorio—. Su propio clone lo probaba.

Arreglo: la URL guardada queda sin credencial y cada comando de red la reescribe por su duración con el mecanismo propio de git (`-c url.<con-credential>.insteadOf=<limpia>`). `run_git` inyecta el override **sólo** para `fetch|pull|push|ls-remote|clone`, así que los comandos locales no pagan lectura de keyring; los remotos no-HTTP (un path local, una URL SSH) no se reescriben ni por el override ni por el reparador; y un clone viejo con el token guardado **se repara solo** en el próximo pull/setup. En `setup` la credencial sale de los valores en mano, porque ahí el keyring y `config.json` se escriben **después** del clone.

Verificación: 49 tests de unidad + 2 de integración verdes. Cinco probes nuevos con git real: el clone guarda la URL limpia y no persiste la regla; el fetch y el push pasan por el override; el reparador no toca remotos no-HTTP ni falla sin `origin`; y la lista de verbos que piden credencial no se ensancha. RED demostrado por mutación: neutralizar el `set-url` del reparador hace fallar el test. Verificador independiente sobre el diff: **S1–S5 pass**, y encontró un defecto real del código nuevo —el reparador *sí* reescribía remotos no-HTTP (`ssh://git@host` → `ssh://host`)— ya arreglado con un guard y pineado por test.

RDD del rango pendiente (`fc7a2e4..d9e08f1`, 9 paths / 562 líneas): `medium`, `review_due: false`, `under_budget` → no corresponde review nativo; el boundary sigue pendiente en el slice.

**Acción del usuario**: reiniciar la app y sincronizar **una vez** (ahí corre la reparación del clone existente) y **rotar el token**, porque estuvo escrito en texto plano en el disco.

Follow-ups que dejó el verificador (informativos, no ejecutados, no autorizan scope por sí solos): una URL pegada en el formulario *con* token se guarda tal cual en `config.json` (pre-existente, igual en `6da1626`); y la credencial ahora viaja en `argv` (`ps` visible), mismo patrón que ya usaban el watcher y el test de conexión, sin escritura a disco.

## Riesgos

- **Frontmatter es dato persistido** (ítem 1): cambiar el render podía reescribir cualquier ticket. Mitigado con `links` emitido **solo cuando no está vacío** y tests de no-regresión para el caso sin links y para archivos legacy.
- **Credenciales** (ítem 2): el service name del keyring cambió de `gitteam` a `gitteam/<id>` por proyecto. La ruta legacy (sin proyecto activo) sigue usando `gitteam`.
- **Contrato de comandos** (ítem 3): se **agregaron** `link_tickets`/`unlink_tickets`/`get_graph` y el campo `links` en `Ticket`; no se removió ni rompió nada existente.

## Gaps conocidos

- **Temas autorables por el usuario**: el picker cubre los tres sets que trae el binario (`default`, `light`, `obsidian`). Cargar un set propio desde disco sigue pendiente — es parte de la visión del producto, no de T12.
- **Preferencias de UI no persistidas**: el tema se recuerda en `localStorage` (`gitteam.theme`), pero `viewMode` sigue sin persistir (vuelve a board en cada arranque).
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
- **L8 (2026-10-17)** — Reporte verbatim: *\"estoy usando y me salen errores del sync, mira los logs\"*.
  Estado real del proyecto `royero-labs` en disco: el repo linkeado es **el repo de aplicación del usuario** (Royero-Labs: backend Python + `lims-web` React + migraciones + tests, 50412 archivos, con `node_modules` commiteado), no un repo de tickets.
  Cadena de daño que se encontró (y que **no llegó a dispararse**: el remoto quedó intacto, `refs/heads/main` == `0d52ea03` == HEAD local):
  1. El índice local estaba reducido a **2 entradas** contra 50412 de HEAD → 50411 borrados staged. Un commit/push desde ahí borraba el repo del usuario en GitHub.
  2. `syncNow` (frontend) hacía: pull → `gitListLocalChanges()` → `gitCommitTicket(file)` **por cada path** → push. `git_list_local_changes` devolvía **todos** los paths sucios del repo, no sólo tickets, y `git_commit_ticket` commiteaba *todo lo que estuviera staged*. Esa combinación era la vía directa al desastre.
  3. Causa de fondo del checkout roto: el timeout de `git clone` era de **60s**. Un repo de 50k archivos (con node_modules commiteado) no clona en 60s, así que el clone moría a mitad de checkout dejando un object store completo al lado de un worktree a medio poblar — y a partir de ahí todo se lee como \"borraron todo\". Lo mismo con `pull` (30s): un pull matado a mitad de rebase deja el índice a medio aplicar (`.git/ORIG_HEAD` presente lo confirma).
  Arreglado en T13: `git_list_local_changes` devuelve **sólo** archivos de ticket; `git_commit_ticket` rechaza cualquier path ajeno y commitea únicamente ese archivo (`git commit -- <path>`); `git_push` difea el rango exacto que publicaría (`upstream...HEAD`) y rechaza si toca algo que no es un ticket; clone 900s + limpieza del directorio si falla; presupuestos de fetch/pull/push/add/commit/status de 60-300s; y `setup_repo_inner` valida que el worktree tenga los archivos rastreados antes de aceptar el proyecto.
  Recuperación aplicada sobre el checkout real: `git reset` (reconstruye el índice desde HEAD) + `git restore --worktree` (materializa los 504 faltantes). Quedó limpio, con los 2 tickets como untracked y el remoto intacto.
- **L9 (2026-10-17)** — Decisión abierta (requiere al usuario): un repo de aplicación no es un repo de tickets. GitTeam fue diseñado asumiendo un repo dedicado a tickets; linkear el repo real de la app hace que los commits `ticket: ...` aterricen en `main` de la aplicación. Opciones: (a) repo dedicado de tickets (recomendado), (b) tickets en un subdirectorio del repo de la app, (c) otra política. Sin respuesta todavía.
- **L10 (2026-10-18)** — Reporte verbatim: *"Antes de eso, asegura que el gitignore esté completo, no quiero ver el rdd en el repo, por ejemplo, luego de eso puedes continuar"*.
  Auditoría: `.atl/` ya estaba ignorado; se agregaron `.codegraph/` (el índice local de CodeGraph sí aparecía como untracked), `.gentle-ai/`, `.gentle-ai-review-index-*` y `reviews/`. Verificado con `git check-ignore -v` sobre rutas sintéticas de cada regla, y `git ls-files` no muestra nada de RDD/atl/review en `HEAD`.
  Dato honesto: `.atl/skill-registry.md` y su cache **estuvieron** commiteados en `a3d184a` y se removieron en `d9c8dc8`; siguen existiendo en la historia. Sacarlos de ahí es reescribir historia (`filter-repo`) y no se hizo sin pedido explícito.
  T12 implementado: la lista de temas vive en `src/lib/theme.ts` (`THEMES`, labels y persistencia) como única fuente; el store expone `theme` + `setTheme` (misma forma que `viewMode`); `setTheme` aplica `data-theme` a `<html>`, lo persiste en `localStorage` (`gitteam.theme`) y actualiza el estado; `main.tsx` aplica el tema recordado **antes** del primer render para que no haya flash. El control en el header reusa el componente `.view-toggle` (`Dark | Light | Obsidian`, iconos, `aria-pressed`, tooltips), sin CSS nuevo.
  Decisión: la elección de tema es preferencia **local de la máquina** (localStorage), no viaja en el repo ni en el frontmatter de los tickets — así no toca ningún formato persistido. El default sigue siendo `default` (dark); no se sniffea `prefers-color-scheme` porque el criterio era que el light sea activable desde la UI.
  Verificación: `npx tsc --noEmit` limpio; `pnpm build` OK (mismo warning de chunk >500 kB, preexistente); chequeo estructural de que cada entrada de `THEMES` tenga su bloque `[data-theme="…"]` en `index.css` (3/3). El frontend no tiene runner de tests (no hay vitest/jest en `package.json`), así que no hay RED/GREEN posible en JS: la comprobación es tsc + build + lectura, y **queda pendiente la pasada visual manual** (`pnpm tauri dev`) para los 3 temas.
  `Risk: none` — no toca datos persistidos de tickets ni contratos de comandos; la clave nueva de `localStorage` es local y opcional.
- **L11 (2026-10-18)** — Pregunta al usuario: preparar el corte en PRs encadenados o seguir con producto. Respuesta verbatim: *"Como gustes"* → decisión delegada. Se eligió **publicar en formato revisable en vez de seguir agregando features**: la rama acumula 28 commits y ~7700 líneas (adición + borrado) y existe **sólo en este disco**, así que el riesgo dominante no era la falta de features sino que todo el trabajo (incluido el fix del sync destructivo) no está publicado en ningún lado.
  Corte en 8 slices con una sola pasada honesta (skill `chained-pr`): ramas `feat/01..08`, cada una apuntando al último commit de su rango contiguo, con el diff de cada PR = exactamente un slice. 9 boundaries verificados en worktree aislado (`cargo test` + `tsc`), 9/9 verdes, con `main` como control (que tiene 0 tests: la suite arranca en el slice 3).
  Pendiente y **gated al humano**: el push de las 9 ramas y la creación de los 8 PR (`open-chain.sh`), porque push y PR siguen siendo decisiones del usuario bajo política ordinaria del repo.
- **L12 (2026-10-18)** — La cadena se publicó: 8 PR abiertos en `astivens/GitTeamII` (#1 → #8, con base encadenada y el diagrama de dependencias) y el review nativo del slice 7 —el único candidato `high`— **aprobado**, con la autoridad quemada y cero correcciones. Los 8 findings no bloqueantes viven en `### Review nativo (RDD)`.
- **L13 (2026-10-18)** — Dirección elegida por el usuario: **L9 = repo dedicado de tickets** (`### L9 decidido`) y después el diseño del flujo de compartir. El bloque siguiente de trabajo es ese diseño; todavía sin empezar.
- **L14 (2026-10-18)** — Hallazgo de seguridad y arreglo: el PAT quedaba en texto plano en `<proyecto>/repo/.git/config` (`### Seguridad`). Commit `d9e08f1`, `Risk: item 2`, verificado por subagente independiente, sin review nativo debido (`under_budget`).

## Criterios de aceptación

- [x] Tailwind removido completamente
- [x] CSS custom properties definidas y themeables vía `[data-theme]`
- [x] Light theme **activable** desde la UI (T12: picker `Dark | Light | Obsidian` en el header, `data-theme` en `<html>`, elección recordada en `localStorage`)
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
- `ui-ux-audit.md`: P0-3 (side panel), P1-9 (markdown preview), P1-13 (theme toggle — resuelto en T12)
