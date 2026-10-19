# Compartir un board — diseño

Objetivo: que dos o más personas compartan un board de tickets sin que nadie tenga que proveer ni correr un servidor, y sin compartir el código de su aplicación.

Rama: `fase-6-v2-redesign` (tracker) · Runner: `cargo test` (Rust) y `npx tsc --noEmit` + `pnpm build` (frontend; no hay runner de tests JS) · Entrega: work-unit commits; el PR se decide cuando el usuario lo pida.

Estado: el usuario aprobó las specs. **T1 (con T2) está implementado** (`3fa2b1e` + `a7b8cc8`) y **T3 está implementado junto con la mitad de T4** (`a5c424f`, corregido en `d5805fc`): un link que del otro lado nadie puede canjear es una UI que miente. T5–T7 siguen pendientes. El diseño no cambió al implementar salvo donde el Log lo dice.

## Specs

**S1 — Un board es un repo dedicado de tickets.** (Decisión L9, registrada en `fase-6-v2-redesign.md`.) Compartir un board es compartir ese repo: el repo de código de la app no participa nunca. Consecuencia: el transporte de la colaboración ya existe (git), y lo que falta es la capa de entrada y de identidad.

**S2 — Crear un board desde la app.** El usuario eligió: *"GitTeam crea el repo de tickets por vos (tu PAT ya tiene scope `repo`) y te devuelve un link de invitación para pasar."*
- Comando backend `board_create(name)`: crea un repo **privado** en GitHub con el PAT del proyecto activo y lo linkea como proyecto reusando `setup_repo_inner` (no se agrega un camino nuevo de clone).
- Nombre por defecto `<proyecto>-board`; si existe, sufijo numérico.
- Hace falta **un cliente HTTP**: hoy no hay ninguno y `git` no puede crear repos. La credencial y el clone/push siguen siendo de `git`.
- Si al PAT le falta el scope `repo`, el error dice **qué falta**; no se propaga un 401 crudo.

**S3 — La invitación es un link, y el mismo string sirve por dos vías.** Contenido: `gitteam://join?repo=<url del clone, url-encoded>&board=<label>&from=<nombre git del que invita>`.
- Vía 1 (deep link): registrar el esquema `gitteam://` para que un click abra la app. En Linux el registro depende del entorno de escritorio (entrada `.desktop`); el plugin de deep links de Tauri v2 cubre lo demás (a confirmar al implementar).
- Vía 2 (sin depender del SO): el mismo string es texto copiable y **pegable** en el campo "Unirme a un board". Es lo que hace que el flujo funcione el día uno.
- El link **no** lleva ninguna credencial. Una invitación no es una credencial (S6).

**S4 — Unirse a un board.** La app parsea el link, muestra **a qué board y de quién viene** antes de tocar nada, y clona con el PAT **del que se une** (keyring por proyecto, `pat_service(Some(id))`, ya existente). Un repo privado compartido necesita credencial de quien entra: es inherente a GitHub, así que la app lo pide explícitamente en pantalla en vez de fallar con un error de git. Requiere que el que entra tenga cuenta de GitHub.

**S5 — El acceso lo otorga el dueño, desde la app, por `@usuario`.**
- `PUT /repos/{owner}/{repo}/collaborators/{username}` con el PAT del dueño: invitar colaboradores es una acción del dueño del repo, no del invitado.
- El pedido de acceso viaja **fuera de la app**, por el mensajero que cada uno ya usa: la app da el link para pasar y un campo para que el invitado devuelva su `@usuario`. Cero servidor nuestro, cero cuenta nueva.
- La invitación de GitHub queda **pendiente** hasta que el invitado la acepta (GitHub manda un mail). La app del invitado puede listar y aceptar las pendientes por API, para que la aceptación no dependa del mail.
- Generaliza a N personas: es la misma operación repetida.

**S6 — Seguridad e identidad.**
- Ningún PAT viaja en la invitación, y ninguno se guarda en el repo. La credencial vive sólo en el keyring de cada máquina (y desde `d9e08f1` ya no queda en `.git/config`).
- Identidad = el `git_user_name` de cada clone (ya funciona así: `config.json` por proyecto + `user.name` por clone). El `assignee` del frontmatter es ese nombre; no hay cuentas ni directorio de usuarios.
- Boards **privados por defecto**. Hacerlo público es una elección explícita, con aviso de qué implica (cualquiera lo lee).

**S7 — El sync es async y ya está.** Pull/push, watcher sobre `ls-remote` y —clave— el **merge driver del slice 7**, que es lo que permite que dos personas editen tickets sin pisarse. El flujo de compartir no necesita transporte nuevo: necesita entrada y claridad.

**S8 — Ciclo de vida.** Desconectar un board compartido no borra nada del remoto. Salir de un board no borra el board de los demás.

## Tasks

| ID | Specs | Qué | Ruta | Estado |
|----|-------|-----|------|--------|
| T1 | S2 | Cliente HTTP + `board_create` (repo privado, linkeo del proyecto) | inline | **hecho** `3fa2b1e` + `a7b8cc8` |
| T2 | S2 | Errores por scope faltante y por nombre tomado | inline | **hecho** dentro de T1 (`3fa2b1e` + `a7b8cc8`) |
| T3 | S3 | Generar y parsear el link de invitación (UI de copiar/pegar) | inline | **hecho** `a5c424f` + `d5805fc` |
| T4 | S4 | Flujo "Unirme a un board" (clonar con el PAT del que entra) | inline | **hecho** dentro de T3 (`a5c424f`); el clone real quedó sin ejercitar (sin red ni cuenta) |
| T5 | S5 | Invitar por `@usuario` + aceptar invitaciones pendientes | inline | pendiente |
| T6 | S3 | Deep link `gitteam://` (registro del esquema) | inline | pendiente |
| T7 | S6 | Verificación de que ni el link ni el repo llevan credenciales | inline | pendiente |

T1 también resuelve el riesgo diario de L9: con `board_create` el proyecto vivo deja de apuntar al repo de la app.

## Decisiones tomadas en el diseño

1. **Board privado + colaborador**, no board público: la alternativa (público, sin PAT del invitado) filtra el board a cualquiera que tenga la URL.
2. **La invitación no es una credencial**: el acceso se otorga en GitHub, no se delega con un token dentro de un link. Un link filtrado no da acceso a nada.
3. **`git` sigue haciendo el trabajo pesado**: el cliente HTTP sólo crea el repo y administra colaboradores. Nada del sync cambia.
4. **El link sirve por las dos vías** (deep link y pegado a mano) porque en Linux el esquema depende del entorno de escritorio y el flujo no puede depender de eso.
5. **El pedido de acceso usa el mensajero que el usuario ya tiene**: es la parte "como wpp" de la visión — el canal social ya existe, nosotros no lo reemplazamos.
6. **El cliente HTTP es `reqwest` con `rustls`**, promovido del grafo de tauri (ya estaba ahí, sin backend TLS, así que lo nuevo son rustls y su provider). Se evaluó hacer las llamadas con `fetch` desde el webview —cero dependencias nuevas— y se descartó: T5 necesita el PAT del keyring, que vive del lado Rust, así que el cliente tenía que estar ahí de todos modos. Consecuencia de build: `rustls` usa el provider aws-lc-rs, que compila una librería C y quiere `cmake` y un toolchain de C (Linux ya los necesita para tauri); no usa el OpenSSL del sistema, a diferencia de `native-tls`.

## Log

- **L1 (2026-10-18)** — Pedido verbatim del usuario para este bloque: *"Invitación: la app crea el repo y da el link"* (elegido entre tres opciones). Visión de producto, verbatim: *"Lo que quiero como tal es una app que haga bien todo lo que no hacen notion, jira, trello, etc, pero free, para eso, necesitamos una forma gratuita de comunicar/enlazar esto con otros usuarios sin tener que proveer un servidor web ni nada, sino permitir que se comuniquen como wpp, como pin, etc"*.
- **L2 (2026-10-18)** — Diseño escrito, sin código. El transporte de colaboración (git + merge driver) ya existe; el trabajo es entrada, permisos e identidad. Pendiente: OK del usuario sobre las specs para arrancar por T1.
- **L3 (2026-10-18)** — OK del usuario, verbatim: *"T1: que la app cree tu board"*. Alcance autorizado: **T1** (S2).
- **L4 (2026-10-18)** — **T1 implementado** (`3fa2b1e`, 739 inserciones / 150 borrados en 7 archivos; por encima del heurístico de ~400 líneas, y es deliberado: el comando sin su punto de entrada no es una rebanada revisable de nada, y el defecto de `App.tsx` que el punto de entrada destapa está entrelazado con la reescritura de `SetupScreen`).

  Backend: `board_create(BoardCreateInput)` crea un repo **privado** con `auto_init` (un repo vacío no tiene rama por defecto y el clone que sigue no podría hacer checkout de nada), reintenta con sufijo numérico sólo ante nombre tomado (422 + `already exists`), y linkea el resultado por `add_project`, o sea por el mismo camino que cualquier otro proyecto: **no se agregó ningún camino nuevo de clone**. Si el linkeo falla después de crear el repo, el error dice que el repo **ya existe** y en qué URL, porque el efecto remoto ya ocurrió y el usuario no puede quedarse sin saberlo.

  Decisión que S2 dejaba abierta: la credencial y la identidad git caen al proyecto activo cuando el usuario no las escribe, así armar un board sobre un proyecto existente es un solo click — el caso concreto que motivó L9, donde el proyecto vivo todavía apunta al repo de la app.

  Se encontró y arregló un **defecto pre-existente** del que depende el punto de entrada: `setupForced` se limpiaba en cuanto hubiera *cualquier* proyecto activo, así que la pantalla de setup on-demand se cerraba en el mismo instante en que se abría y el CTA "Link new repository" quedaba muerto mientras hubiera un board abierto. Ahora se cierra cuando el proyecto activo **cambia** (envío exitoso) y hasta entonces ofrece volver.

  Evidencia: RED primero (los tests del núcleo puro no compilaban: las funciones no existían), luego **57 tests de unidad + 2 de integración en verde**, `npx tsc --noEmit` en 0 y `pnpm build` en 0. RED por mutación: neutralizar la rama que detecta el scope faltante hace caer el test del scope, y sólo ése.

  Límite honesto: la llamada a la API de GitHub no se puede ejercer sin red ni cuenta, así que está cubierta por tests de unidad sólo en sus decisiones puras (nombre por defecto y saneado, candidatos ante nombre tomado, mensaje de error por status y scope, elección de credencial e identidad), y la llamada quedó delgada a propósito. `Risk: item 5` (dependencia nueva directa) e `item 6` (la llamada no la cubre ningún test).
- **L5 (2026-10-18)** — Observación que **no** introduce este cambio: `src-tauri/Cargo.lock` está en `.gitignore` (`.gitignore:28`), así que la resolución exacta de la dependencia nueva no queda en el repo, y el `cmake` + toolchain de C que pide `aws-lc-rs` no está documentado en ningún lado para quien compile. Para una app que se distribuye como binario, versionar el lock es lo recomendable; queda como pendiente para que lo decida el usuario (no lo toqué).
- **L6 (2026-10-18)** — **Verificación independiente de T1** (verificador fresco, alcance `1cf073c..3fa2b1e`): **cero blockers**. Pasaron `cargo test` (57+2 en ese momento), `npx tsc --noEmit`, `pnpm build`, y los invariantes por lectura: un solo camino de clone (`board_create` → `add_project` → `setup_repo_inner`), `private: true`, `auto_init: true`, sólo el nombre tomado se reintenta y todo lo demás se corta al primer error, el header de scopes se lee y su ausencia está contemplada, y `adoptActiveProject` es un movimiento literal del cuerpo que reemplazó (o sea: el flujo de "conectar un repo existente" no cambió de comportamiento). La cadena publicada quedó intacta y el árbol limpio después de las pruebas.

  El hallazgo que importaba, y que arreglé en `a7b8cc8`: **mutar `"private": true` a `false` no hacía caer ningún test** — la promesa de S6 ("boards privados por defecto") no tenía red, porque el payload sólo existía como literal dentro de la función que hace la llamada. Ahora el cuerpo sale de `board_create_body` y un test lo fija, junto con `auto_init`. RED por mutación confirmado *después* del arreglo (antes escapaba, ahora cae). En el mismo commit entraron sus 3 tests de regresión y una corrección al mensaje de scope: cuando el header **no viene**, no se puede afirmar que al token le falten permisos —los fine-grained no reportan scopes—, así que el mensaje dice qué hace falta para crear un repo en vez de afirmar lo que el token tiene.

  Advisory que **no** se tocó, con motivo: el reintento sólo ante nombre tomado no tiene test propio porque el loop vive en el comando async y no hay costura sin inventar una abstracción de más; el verificador lo probó por mutación (`(&base, 4)` → `(&base, 1)` pasa la suite). Es exactamente el límite que declara `Risk: item 6`. Quedan como advertencias abiertas, sin acción en este cambio: no hay tope de 100 caracteres en el saneado del nombre (un nombre larguísimo da un 422 que se informa tal cual, sin reintento) y el `Cargo.lock` sin versionar (L5). Lo que no se pudo verificar y no se afirma: la llamada real a la API de GitHub (sin red ni cuenta) y el comportamiento en runtime de la UI (no hay runner de tests JS en el repo).
- **L7 (2026-10-18)** — OK del usuario, verbatim: *"Dale con T3"*. Alcance autorizado: **T3** (S3). Al implementarlo se adelantó la mitad de T4 (S4) por una razón de honestidad, no de tamaño: un modal que ofrece copiar un link que del otro lado nadie puede canjear es una UI que miente, y canjearlo resultó casi gratis — unirse es el mismo camino de clone que ya existía (`add_project` con el PAT del que entra), no un camino nuevo.

  **T3 implementado** (`a5c424f`, 632 inserciones / 80 borrados en 6 archivos). El formato es un solo string, `gitteam://join?repo=…&board=…&from=…` (S3), que se construye de un lado y se lee del otro: las dos mitades viven juntas y un test de ida y vuelta las fija. Dos reglas del formato, probadas en las dos direcciones: el link **nunca** lleva una credencial (una url guardada que igual tenía token se limpia al construir, y un link editado a mano se limpia al parsear, así que ninguna de las dos direcciones puede meter una credencial en la string que el usuario pasa ni en el clone que viene después); y la codificación es de query, no de formulario (`+` es un más; un `%zz` se informa en vez de adivinarse). Frontend: el switcher ofrece "Invite someone" y muestra el link para copiar; la pantalla de setup gana el tercer modo "Join a board", que lee la invitación, dice a qué board y de quién viene **antes** de clonar nada (S4) y recién después entra por el camino de proyecto existente con la credencial del que entra. El modal dice explícitamente que el link **no es una llave**: el board es privado, así que el acceso lo otorga GitHub — hasta que exista invitar por `@usuario` (T5), ése es un paso manual.

  Evidencia: RED primero (los tests del núcleo no compilaban), después **70 tests de unidad + 2 de integración en verde** (68 en `a5c424f`, +2 en la corrección), `npx tsc --noEmit` en 0 y `pnpm build` en 0. RED por mutación, dos veces: neutralizar el saneamiento de la url hace caer el test de credenciales, y forzar a `false` el guard de password hace caer el test nuevo y sólo ése.
- **L8 (2026-10-18)** — **Verificación independiente de T3** (verificador fresco, alcance `18c6581..a5c424f`): **1 blocker + 4 advisories**. S3 verificado (ida y vuelta exacta, credencial limpiada en las dos direcciones, query y no formulario, escapes rotos informados, comandos a nivel de borde), S4 verificado en parseo y en "se muestra antes de tocar nada"; además corrió la suite del baseline (61+2) para probar que la rebanada sólo **agrega** 7 tests y no edita ninguno, y que el diff del backend es puramente aditivo.
  - **Blocker (arreglado en `d5805fc`)**: reescribir `SetupScreen` cambió la etiqueta del botón ocupado del flujo de **conectar** de `"Testing & connecting…"` a `"Connecting…"`. Nadie lo pidió: es exactamente el caso que el invariante "la salida existente no cambia" prohíbe. Volvió al string original. Mi propio diff ya había cazado y revertido un cambio hermano en la misma reescritura (el toast había pasado de `test.repo_name` a `project.name`), lo que confirma que la clase de defecto era real y no teórica.
  - **Advisory convertido en arreglo**: la promesa "el link nunca lleva una credencial" valía sólo para http(s); un `ssh://user:token@host` conservaba el password en las dos direcciones. Ahora un nombre de usuario se respeta (`ssh://git@host` es una dirección, no una credencial) y un password se va en cualquier scheme.
  - **Adoptado del verificador**: el guard que faltaba (`board=a+b` escrito a mano: la ida y vuelta **no puede** atrapar una decodificación de formulario, porque construir siempre emite `%2B`), tablas más anchas de escapes rotos y de strings rechazadas, tolerancia a un parámetro desconocido, y el recorte de espacios del label fijado por test. **No adoptado**: su test a nivel de comando que escribe y borra `$HOME/.gitteam-config.json` — un test que toca la configuración real del usuario no se queda, ni ignorado.
  - Advisories que **no** se tocaron, con motivo: `strip_userinfo` corta todo lo anterior al primer `@`, así que una url con `@` en el path (`https://github.com/org/repo@2.git`) se rompe; es pre-existente (viene de `d9e08f1`), está fuera de dominio (un path de GitHub no puede llevar `@`) y arreglarlo tocaría código compartido ya verificado por otra rebanada, así que queda registrado y no se toca.
  - Lo que **no** se pudo verificar y no se afirma: el clone real del flujo de unirse (sin red ni cuenta: el camino quedó cubierto sólo por lectura) y el runtime de la UI (no hay runner de tests JS).
  - Nota de entorno que costó caro: el verificador copió el repo a `/tmp` para probar —`/tmp` acá es un tmpfs de 12 GB y `src-tauri/target` pesa 13 GB— y dejó `/tmp` al 100 %; el scratch se limpió y de acá en más va a `/var/tmp`.
- **L9 (2026-10-18)** — RDD sobre la rebanada `fc7a2e4..d5805fc`: `risk: medium`, `review_due: false`, `review_due_reason: under_budget` (17 paths, ~2.2k líneas). La frontera revisada sigue en `fc7a2e4`: el borde no se movió y el review nativo no se dispara todavía.
