# Compartir un board — diseño

Objetivo: que dos o más personas compartan un board de tickets sin que nadie tenga que proveer ni correr un servidor, y sin compartir el código de su aplicación.

Rama: `fase-6-v2-redesign` (tracker) · Runner: `cargo test` (Rust) y `npx tsc --noEmit` + `pnpm build` (frontend; no hay runner de tests JS) · Entrega: work-unit commits; el PR se decide cuando el usuario lo pida.

Este documento es **diseño**: todavía no se escribió código. Falta el OK del usuario sobre las specs para arrancar por T1.

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
| T1 | S2 | Cliente HTTP + `board_create` (repo privado, linkeo del proyecto) | inline | pendiente |
| T2 | S2 | Errores por scope faltante y por nombre tomado | inline | pendiente |
| T3 | S3 | Generar y parsear el link de invitación (UI de copiar/pegar) | inline | pendiente |
| T4 | S4 | Flujo "Unirme a un board" (clonar con el PAT del que entra) | inline | pendiente |
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

## Log

- **L1 (2026-10-18)** — Pedido verbatim del usuario para este bloque: *"Invitación: la app crea el repo y da el link"* (elegido entre tres opciones). Visión de producto, verbatim: *"Lo que quiero como tal es una app que haga bien todo lo que no hacen notion, jira, trello, etc, pero free, para eso, necesitamos una forma gratuita de comunicar/enlazar esto con otros usuarios sin tener que proveer un servidor web ni nada, sino permitir que se comuniquen como wpp, como pin, etc"*.
- **L2 (2026-10-18)** — Diseño escrito, sin código. El transporte de colaboración (git + merge driver) ya existe; el trabajo es entrada, permisos e identidad. Pendiente: OK del usuario sobre las specs para arrancar por T1.
