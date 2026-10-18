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

- **S3 — El merge de tickets concurrentes no puede explotar.** (requisito vigente; mecanismo
  **decidido** e implementado: un merge driver propio, elegido por el usuario entre los tres
  caminos de L4 — ver L6.)
  El requisito no cambió: cuando dos personas tocan el mismo tablero, la sincronización tiene que
  resolverse sin perder datos y sin dejar nunca un ticket ilegible. El mecanismo que se había
  aprobado — `merge=union` en `.git/info/attributes` — quedó **descartado por evidencia** (L2):
  duplica claves YAML, el archivo deja de parsear y el ticket **desaparece del tablero sin que
  git reporte conflicto**.

  Mecanismo implementado: el binario de la app tiene un segundo entry point,
  `gitteam merge-driver <base> <ours> <theirs>`, que git invoca como driver de `TKT-*.md`. Fusiona
  campo por campo (gana el lado que cambió respecto de la base; si los dos cambiaron, gana el
  `last_updated` más nuevo; el `uid` conserva el más viejo; `tags` y `links` se unen) y conserva los
  dos cuerpos, escribiendo una sola vez las líneas que ambos comparten. El registro vive en
  `.git/info/attributes` y en `.git/config` del clone —nunca versionado— y se hace al conectar el
  proyecto y antes de cada pull. Si el driver no está o falla, git cae a su merge interno y deja un
  conflicto normal: por eso todo lo que no se puede parsear termina en `exit 1`, sin escribir nada.

  Criterios de aceptación:
  1. Ninguna sincronización puede dejar un ticket que no parsee, y menos en silencio. Si hay que
     elegir entre dos valores, la elección es determinista y queda registrada.
  2. Los cuerpos de los dos lados no se pierden.
  3. **No** se agrega ningún archivo versionado nuevo al repo del usuario.
  4. Si el mecanismo depende de algo instalado en la máquina, su ausencia degrada a un conflicto
     normal —que la app ya sabe resolver— nunca a un error duro.

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
| T1 | S5 | Separar `repo_root()` (git: `.git`, clone/fetch/pull/push/status) de `tickets_dir()` (los `.md`). 13 call sites de git, 9 de archivos de ticket. | inline | hecho | `06b5c04` |
| T2 | S2 | `uid` (ULID) en frontmatter + renumeración al merge + reescritura de `links`. | inline | hecho | `ec01beb` |
| T3 | S3 | Merge driver propio: segundo entry point `merge-driver` del binario, política campo por campo (tags/links unidos, `uid` más viejo, cuerpos con las líneas compartidas escritas una vez), registro idempotente en `.git/info/attributes` + `.git/config` al conectar y antes de cada pull, degradación a conflicto normal. | inline | hecho (riesgo: **item 1**, formato persistido) | este commit |
| T4 | S2 | Prueba real de dos clones offline con git de verdad (repo bare local, fuera del workspace). | inline | hecho | `d080b63` |

Regla de ruta: un solo cambio entendido por vez, inline (el Writer trigger no aplica: no hay
unidades independientes en paralelo ni backstop de contexto). Cada tarea es su propio commit.

### Dependencia anotada para la tarea futura (subdirectorio de tickets)

Cuando `tickets_dir()` deje de ser igual a `repo_root()`, **cambian dos cosas más**, y no son
opcionales:

1. La guarda `is_owned_ticket_path` tiene que pasar de "raíz" a prefijo (`tickets/TKT-*.md`),
   porque los paths de `git status --porcelain` y de `git diff --name-only` son relativos a la
   raíz del repo, no a la carpeta de tickets.
2. El pathspec de `git_commit_ticket` (`git add/commit -- <filename>`) necesita el prefijo.
3. `MERGE_DRIVER_PATTERN` (`TKT-*.md` en `.git/info/attributes`) es relativo a la raíz del repo:
   tiene que pasar a `tickets/TKT-*.md` en el mismo movimiento, o el driver deja de aplicarse en
   silencio —el merge vuelve a ser el interno, que es justo el que rompe los tickets—.

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

- **L2 (2026-10-18) — T1 hecho.** Refactor puro. La clasificación quedó verificada por el
  compilador: 13 call sites de git, 9 de archivos de ticket, ninguno ambiguo. Dos cosas que la
  exploración evitó: (a) el renombre masivo mordió `fn init_data_dir()` porque el texto
  `init_data_dir()` contiene `data_dir()`; quedó como `init_repo_root` mientras `generate_handler!`
  seguía registrando `init_data_dir`, o sea un error de compilación que igual conviene no dejar
  pasar (detectado por una aserción antes de escribir); (b) la nota de stderr sobre el layout
  legado vivía en la función de git y pasó al lado de tickets, que es a quien le corresponde.
  Verificación: `cargo test` 17/17 sin tocar un test, `cargo check` limpio, y auditoría de
  contrato: los 33 `invoke` del frontend resuelven a comandos registrados.

- **L3 (2026-10-18) — T2 hecho.** `uid` ULID + renumeración. Un hallazgo de la exploración valía un
  bug: `update_ticket` reconstruía el `Ticket` campo por campo, así que habría **borrado el `uid`
  en cada edición** —la identidad del ticket—; y el test existente `update_ticket_preserves_links`
  decía pasar por `update_ticket` pero escribía a mano, así que no lo habría detectado. Ahora llama
  a la función real (`update_ticket_in`).
  Entropía sin dependencias nuevas: `getrandom` ya estaba en el grafo vía tauri, así que se
  promovió a dependencia directa y `Cargo.lock` quedó **byte-idéntico** (verificado con `git
  diff`): cero crates nuevos.
  El encoder se validó contra una implementación independiente (entero de 128 bits → base32, hecha
  aparte en Python) y contra los valores límite del spec (`0…0` y `7ZZ…Z`). El vector mixto quedó
  como test de regresión, junto con la lectura de vuelta del timestamp: un test de orden entre
  nosotros solos habría pasado igual con el orden de bytes mal.
  RED observado antes de implementar: con `reconcile_ticket_ids_in` en stub, los dos tests de
  reconciliación fallaron (0 renombres donde se esperaba 1); con la implementación real, 28/28.

- **L4 (2026-10-18) — T4 hecho. T3 bloqueada: el mecanismo aprobado quedó descartado por evidencia,
  no implementado.**
  T4: el probe con git real pasa (`cargo test` 29/29). Colisión `TKT-1000` reproducida en dos
  clones, merge limpio sin conflicto, se renumera el perdedor conservando su `uid`, la referencia
  que ese ticket ya tenía lo sigue, y al propagar el arreglo el otro clone queda con un dueño único
  de `TKT-1000` y nada propio que renumerar.
  T3: antes de escribir un atributo de merge en un repo, probé qué produce realmente. Con
  `git merge-file --union` sobre dos versiones que cambian el mismo campo:
  ```
  status: "in-progress"
  status: "done"
  ```
  y el parseo devuelve `PARSE ERROR: frontmatter is not a mapping`. Claves YAML duplicadas.
  `parse_ticket_file` rechaza el archivo, `load_all_tickets` lo saltea con un mensaje a stderr y
  `git_list_conflicts` (`git diff --diff-filter=U`) no reporta nada, porque git da el merge por
  exitoso. O sea: **el ticket desaparece del tablero sin conflicto, sin error y sin nada en la UI**
  — peor que un conflicto, que la app sí sabe resolver porque lee los stages del índice
  (`git show HEAD:<file>`, `--diff-filter=U`), independientes del archivo roto del worktree.
  Los cuerpos sí se conservan ("Ours body\nTheirs body"); lo que rompe es el frontmatter.
  Decisión pendiente del usuario, tres caminos: (a) no escribir ningún driver y dejar que el
  solapamiento real aparezca como conflicto resoluble; (b) `merge=union` más una pasada que colapse
  las claves duplicadas con un ganador determinista, enganchada donde ya se renumera; (c) un merge
  driver propio registrado en `.git/config` local (campo por campo, tags/links unidos, cuerpos
  concatenados), que degrada a conflicto normal si el driver no está.
  Nada de esto se implementó sin decisión.
  Limitación conocida, anotada: una referencia `links:` a un id disputado se reescribe hacia el id
  renumerado. Es correcto cuando un solo lado la escribió (el caso común) y queda apuntando al
  ticket equivocado si los dos lados tenían referencias al mismo id; sin procedencia en el archivo
  no hay forma de distinguirlas.

- **L5 (2026-10-18) — Medido: un merge driver propio degrada bien y funciona en el pull de la app.**
  Antes de proponerlo medí el comportamiento real de git con `merge=<driver>` en
  `.git/info/attributes`:
  1. Driver cuyo comando **no existe**: git avisa y cae al merge interno → conflicto normal (`UU`
     en el índice, marcadores en el worktree). No es un error duro.
  2. Driver que existe pero **falla** (`exit 1`): igual, conflicto normal.
  3. Driver que funciona: merge limpio, `exit 0`, se usa su salida.
  Y con el driver registrado, `git pull --rebase --autostash` —el camino que usa la app— también lo
  usa: rebase aplicado sin conflicto y el archivo quedó con la salida del driver.
  El atributo y la config del driver viven en `.git/info/attributes` y `.git/config` del clone:
  `git ls-files` no muestra nada nuevo, así que el repo del usuario no gana ningún archivo
  versionado (S3.3).
  Conclusión: un driver propio es el único camino que satisface los cuatro criterios a la vez —
  S3.1 nunca deja un ticket ilegible, porque el archivo nunca pasa por un estado con claves
  duplicadas; S3.2 tiene los dos lados como entradas separadas, así que puede unir cuerpos y
  resolver campo por campo con información real; S3.4 degrada a conflicto normal si falta o falla.
  La reparación posterior a `union` (camino b) tiene que decidir sobre un archivo en el que ya se
  perdió la procedencia de cada valor, y deja una ventana con el archivo inválido. Decisión del
  usuario pendiente en L6.

- **L6 (2026-10-18) — T3 hecho: merge driver propio (el usuario eligió el camino (c) de L4).**
  El usuario eligió el driver propio por sobre los otros dos caminos, con la evidencia de L2 y L5
  sobre la mesa.

  Cómo quedó, en `src-tauri/src/lib.rs` salvo el entry point:
  - `merge-driver <base> <ours> <theirs>` es un segundo entry point del binario: `main.rs` corta el
    argumento **antes** de `gitteam_lib::run()`, así que el camino de git nunca abre una ventana.
  - El código de salida es la respuesta: `0` significa "`%A` tiene el resultado", cualquier otra
    cosa significa "no pude" y git hace su merge dejando un conflicto normal. Todo lo que no se
    puede parsear termina en `exit 1` **sin escribir** `%A`: eso es lo que hace verificable S3.1.
  - Política: gana el lado que cambió respecto de la base; si los dos cambiaron el mismo campo, gana
    el `last_updated` más nuevo; el `uid` conserva el más viejo (el mismo criterio que la
    renumeración de T2, para no decidir identidad con un reloj); `tags` y `links` se unen cuando los
    dos las tocaron; el cuerpo conserva los dos lados.
  - El registro (`.git/info/attributes` + `git config merge.gitteam-ticket.driver`) es idempotente,
    no pisa reglas que ya estaban y no agrega nada versionado (S3.3). Corre al conectar el proyecto
    y **antes** de cada pull: si corriera después, el merge de ese pull no lo usaría.
  - Sin `TKT-*.md` el driver no aplica a ningún otro archivo del repo: el patrón nombra exactamente
    lo que la app posee.

  Dos hallazgos que valen más que el código:
  1. Un cuerpo editado por los dos lados se duplicaba entero, porque el cuerpo de cada lado incluye
     el texto que ambos conservaron. Ahora las líneas compartidas al principio y al final se
     escriben una sola vez y sólo las diferencias quedan separadas por una regla `---`. Medido en el
     probe de dos clones: antes `Opening paragraph` dos veces, después una sola. El texto no se
     pierde en ningún caso; esto es ruido menos, no corrección.
  2. `git rev-parse --abbrev-ref HEAD` en un repo **sin commits** devuelve `HEAD`, no el nombre de la
     rama. El test de punta a punta hacía `checkout HEAD`, que no cambia nada, así que los dos
     commits caían en la misma rama y el merge decía "ya está actualizado": parecía un driver roto y
     era el test. Lo encontró la aserción sobre la salida del driver; leer el código no lo mostraba.

  Verificación: `cargo test` **42/42** (40 en la lib, 2 de integración) y `cargo check` limpio, sin
  warnings; cero cambios en `Cargo.toml`/`Cargo.lock` (los tests de integración usan `tokio`, que ya
  estaba). Sin cambios de frontend: `npx tsc --noEmit` sigue limpio.
  `src-tauri/tests/merge_driver_cli.rs` corre el **binario real** como lo corre git —es lo único que
  puede probar que `main` enruta el argumento— y verifica el merge limpio, el archivo resultante
  parseable y el rechazo dejando `%A` intacto.
  El registro se prueba con git de verdad: dos ramas que cambian el mismo ticket, el driver
  registrado y el merge sin conflicto, con `git diff --diff-filter=U` vacío. El driver de ese test
  es un script, nunca el binario de test: apuntar git al binario de test lo haría re-ejecutar la
  suite desde adentro de un merge.
  Probe de punta a punta, fuera del workspace (`/tmp/opencode/t3probe2`): repo bare local, dos
  clones, cada uno edita el mismo `status` y agrega su párrafo, y el pull es el de la app
  (`git pull --rebase --autostash`) con **el binario de la app** como driver. Resultado: `exit 0`,
  sin conflicto, `status: "done"` (el `last_updated` más nuevo: 01-03 contra 01-02), los dos
  párrafos en el cuerpo y `Opening paragraph` una sola vez, y `git ls-files` con sólo `TKT-1.md`.
  Riesgo declarado: **item 1** — el driver decide el contenido de archivos persistidos. La
  contención es que nunca escribe un archivo que no pudo parsear y que toda elección es
  determinista.
