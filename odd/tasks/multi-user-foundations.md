# Multi-user foundations

Objetivo: dejar el formato de ticket y el almacenamiento a salvo de más de una persona,
antes de que exista cualquier colaboración real. Sin esto, el primer repo compartido
produce ids duplicados y merges conflictivos en archivos que nadie puede arreglar a mano.

Rama: `fase-6-v2-redesign` (local, sin push). Delivery strategy: `ask-on-risk`.
Runner: `cd src-tauri && cargo test` · `npx tsc --noEmit` · `pnpm build`.

## Specs

- **S1 — El transporte es git, y la promesa es asíncrona.**
  Textual del usuario, eligiendo entre tablero compartido asíncrono y tiempo real:
  > "Es lo primero"

  Es decir: el tablero compartido donde los cambios llegan cuando se sincroniza. **No**
  hay presencia ni edición en vivo: eso requeriría CRDT más relay para atravesar NAT, o
  sea infraestructura, y contradice "gratis y sin servidor". Ningún requisito de este
  documento puede asumir tiempo real.

- **S2 — Los ids de ticket sobreviven a dos autores offline, sin perder el copiar/pegar rápido.**
  Plan aprobado por el usuario (respondió "Dale" a esta propuesta):
  > "El `TKT-1042` lindo y corto queda como lo que ves y copiás; en el frontmatter va un
  > **ULID** como identidad real. Cuando dos clones generan el mismo `TKT-1042`, al mergear
  > la app **renumera** el perdedor (el timestamp del ULID decide) y **reescribe los `links`**
  > que apuntaban a él."

  Criterios de aceptación:
  1. `create_ticket` sigue produciendo un id visible `TKT-####` (formato y ancho sin cambios).
  2. Todo ticket nuevo lleva un `uid` único y estable en el frontmatter.
  3. Un archivo legacy sin `uid` sigue parseando (el campo se emite sólo cuando existe, mismo
     criterio que se usó con `links`).
  4. Si dos tickets comparten id visible, gana el que tiene el `uid` más viejo y el otro se
     renumera a un id libre, sin colisionar con ningún archivo presente.
  5. Toda referencia en `links:` que apuntara al id renumerado se reescribe; los ids
     renumerados no pueden quedar apuntando a la nada.

- **S3 — El merge de tickets no se pelea en los archivos append-only.**
  Plan aprobado por el usuario:
  > "Escribo `merge=union` para `TKT-*.md` en **`.git/info/attributes`**, no en un
  > `.gitattributes` commiteado."

  Criterios de aceptación:
  1. La app asegura el atributo al linkear/conectar el repo, de forma idempotente.
  2. **No** se agrega ningún archivo nuevo al repo del usuario (nada de `.gitattributes`
     versionado): la config es local del clone.

- **S4 — No se toca ningún repo ajeno.**
  La rama sigue siendo local: sin push, sin PR, sin commits fuera de acá. El repo del
  usuario (`Royero-Labs`) queda fuera de alcance.

- **S5 — Paso 1 es refactor puro.**
  Textual del plan aprobado:
  > "Comportamiento idéntico, cero cambio visible."

  Criterios de aceptación: los 17 tests existentes siguen verdes sin modificarlos y
  `cargo check` queda limpio.

## Tasks

| ID | Specs | Qué | Ruta | Estado | Commit |
|----|-------|-----|------|--------|--------|
| T1 | S5 | Separar `repo_root()` (git: `.git`, clone/fetch/pull/push/status) de `tickets_dir()` (los `.md`). 13 call sites de git, 9 de archivos de ticket. | inline | pendiente | — |
| T2 | S2 | `uid` (ULID) en frontmatter + renumeración al merge + reescritura de `links`. | inline | pendiente | — |
| T3 | S3 | `merge=union` para `TKT-*.md` en `.git/info/attributes`, idempotente, al setup/connect. | inline | pendiente | — |
| T4 | S2 | Prueba real de dos clones offline en `mktemp -d` (fuera del workspace) + tests de regresión puros. | inline | pendiente | — |

Regla de ruta: un solo cambio entendido por vez, inline (el Writer trigger no aplica: no hay
unidades independientes en paralelo ni backstop de contexto). Cada tarea es su propio commit.

### Dependencia anotada para la tarea futura (subdirectorio de tickets)

Cuando `tickets_dir()` deje de ser igual a `repo_root()`, **cambian dos cosas más**, y no son
opcionales:

1. La guarda `is_owned_ticket_path` tiene que pasar de "raíz" a prefijo (`tickets/TKT-*.md`),
   porque los paths de `git status --porcelain` y de `git diff --name-only` son relativos a la
   raíz del repo, no a la carpeta de tickets.
2. El pathspec de `git_commit_ticket` (`git add/commit -- <filename>`) necesita el prefijo.

No se implementa ahora: sería una abstracción especulativa. Queda anotado porque es
exactamente el tipo de acoplamiento que rompe en silencio.

## Log

- **L1 (2026-10-18)** — Pedido del usuario, textual: *"Dale"*, aceptando este plan (textual del
  plan aprobado):
  > "**Paso 1 — Split `repo_root()` / `tickets_dir()`** … **Paso 2 — Esquema de ids: display
  > corto + ULID de identidad** … **Paso 3 — Union merge driver** … **Cómo lo verifico** — no con
  > "los tests pasan", sino con una prueba real en un directorio temporal (`mktemp -d`, fuera del
  > workspace): dos clones del mismo repo, cada uno crea un ticket **offline** → el `TKT-1042`
  > colisiona → mergeo y compruebo que la renumeración ocurre y que los `links` quedan apuntando
  > al ticket correcto."

  Antes de eso, el usuario cerró las dos decisiones grandes: promesa **asíncrona** (textual:
  *"Es lo primero"*) y compartir por **git**. Y su marco de producto, textual:
  > "Lo que quiero como tal es una app que haga bien todo lo que no hacen notion, jira, trello,
  > etc, pero free, para eso, necesitamos una forma gratuita de comunicar/enlazar esto con otros
  > usuarios sin tener que proveer un servidor web ni nada, sino permitir que se comuniquen como
  > wpp, como pin, etc"
