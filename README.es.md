# GitTeam

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows-7c5cff)](#generar-un-distribuible)

[English](README.md) · **Español**

GitTeam es un gestor de tickets gratuito y local-first donde **cada ticket es un archivo Markdown dentro de un repositorio Git que tú controlas**. No hay servidor que mantener, ni cuenta que crear, ni base de datos de un proveedor. El equipo colabora compartiendo ese repositorio, de forma asíncrona: igual que comparte el código.

---

## Índice

- [Por qué otro gestor de tickets](#por-qué-otro-gestor-de-tickets)
- [Características](#características)
- [Cómo funciona la colaboración](#cómo-funciona-la-colaboración)
- [Requisitos](#requisitos)
- [Puesta en marcha](#puesta-en-marcha)
- [Uso de la aplicación](#uso-de-la-aplicación)
- [Dónde viven tus datos](#dónde-viven-tus-datos)
- [Formato de un ticket](#formato-de-un-ticket)
- [Arquitectura](#arquitectura)
- [Modelo de seguridad](#modelo-de-seguridad)
- [Generar un distribuible](#generar-un-distribuible)
- [Desarrollo](#desarrollo)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Fuera de alcance](#fuera-de-alcance)
- [Agradecimientos](#agradecimientos)

## Por qué otro gestor de tickets

La mayoría de las herramientas de tickets son bases de datos opacas detrás de un servicio. No puedes hacer `grep` de un ticket, ni verlo en un diff, ni pasárselo a un asistente de IA sin perder contexto, y no puedes llevarte tus datos.

GitTeam invierte eso:

- **El ticket es el archivo.** Frontmatter YAML más un cuerpo Markdown. El tablero es una vista de ese archivo, no un registro en una base de datos.
- **La capa de sincronización es Git.** Historial, `blame`, pull requests, copias de seguridad y control de acceso vienen del remoto que ya usas.
- **No hay nada que alojar.** La aplicación es un binario de escritorio; el estado compartido es un repositorio.
- **La IA recibe los mismos bytes que ves tú.** *Copiar para IA* copia el Markdown crudo, sin transformación.

## Características

| | |
|---|---|
| **Tickets en Markdown** | Frontmatter (id, estado, responsable, prioridad, etiquetas, enlaces) más un cuerpo libre. El mismo archivo en la aplicación, en tu editor, en Git y en un prompt. |
| **Tablero kanban y grafo** | Un tablero agrupado por estado y un grafo de fuerzas estilo Obsidian con los enlaces `links:` entre tickets. Al pasar el cursor se resaltan los vecinos, al arrastrar se mueve un nodo, al hacer clic se abre el ticket. |
| **Pensado para el teclado** | Paleta de comandos con `⌘K`, `N` nuevo ticket, `Y` copia el id del último ticket visto, `G` `K` tablero / `G` `G` grafo, `?` ayuda de atajos. |
| **Copiar para IA** | Un botón copia el Markdown crudo de un ticket, listo para pegar en cualquier asistente. |
| **Local-first** | Crear, editar y borrar funciona sin conexión. La red se usa solo para sincronizar el repositorio. |
| **Sincronización automática** | Las ediciones se agrupan con un retardo, un vigilante consulta el remoto cada 15 segundos y, al recuperar el foco, la ventana trae los cambios pendientes. |
| **Resolución de conflictos** | Los archivos de ticket se fusionan campo por campo con un driver de merge propio. Cuando no se puede resolver, una vista lado a lado muestra local frente a remoto por archivo, con local / remoto / ambos por archivo. |
| **Multi-proyecto** | Un checkout local y una credencial por repositorio. El tablero se cambia desde la cabecera. |
| **Compartir desde la aplicación** | Crear un repositorio de tickets, invitar a un colaborador por su usuario de GitHub o copiar un enlace de invitación. |
| **Enlace profundo** | `gitteam://join?…` abre la aplicación directamente en el flujo de unirse. |
| **Temas** | Tres conjuntos de tokens — `default` (oscuro), `light` y `obsidian` — conmutables desde la cabecera y recordados localmente. |
| **Interfaz bilingüe** | Inglés y español, conmutables desde la cabecera, detectados del idioma del sistema y recordados localmente. Los diagnósticos de Git y del backend se mantienen en inglés. |
| **Sin telemetría** | Sin analítica y sin llamadas salientes más allá del remoto Git que hayas configurado. |

## Cómo funciona la colaboración

Un **tablero es un repositorio**. Compartir un tablero es compartir ese repositorio:

1. **Crea o conecta un tablero.** La aplicación puede crear un repositorio dedicado de tickets a través de la API de GitHub, o conectarse a un remoto HTTPS existente. Los tickets nunca viven dentro del repositorio de código.
2. **Invita a alguien.** Añádelo como colaborador por su nombre de usuario, o envíale un enlace de invitación (`gitteam://join?repo=…&board=…&from=…`). El enlace no es una credencial: no lleva ningún token.
3. **Trabaja sin conexión y sincroniza con Git.** Cada lado confirma y sube a su ritmo; el otro descarga. Los archivos de ticket se fusionan campo por campo, así que dos personas editando campos distintos del mismo ticket no se pisan.

Es una colaboración **asíncrona** por diseño. No hay presencia, ni cursores compartidos, ni canal en tiempo real, porque no hay servidor que lo proporcione.

## Requisitos

- **Node.js** `^20.19.0` o `>=22.12.0` (lo exige Vite 8)
- **pnpm** 9 o superior (el repositorio incluye `pnpm-lock.yaml`)
- **Rust** 1.85 o superior (el crate usa la edición 2024) con Cargo
- **Git** en el `PATH`
- **CMake y un compilador de C** — el cliente HTTP usa `rustls` con `aws-lc-rs`, que compila código nativo. No se necesita OpenSSL del sistema.

En Linux hacen falta además las bibliotecas de Tauri 2:

```bash
# Debian / Ubuntu
sudo apt install build-essential pkg-config cmake libwebkit2gtk-4.1-dev \
  libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev \
  libxdo-dev libssl-dev

# Arch Linux
sudo pacman -S --needed base-devel pkgconf cmake webkit2gtk-4.1 gtk3 \
  libsoup3 librsvg libayatana-appindicator libxdo openssl
```

En macOS hacen falta las Command Line Tools de Xcode. En Windows, las herramientas de compilación de MSVC y WebView2 (viene preinstalado en Windows actuales).

## Puesta en marcha

```bash
git clone https://github.com/astivens/GitTeamII.git
cd GitTeamII
pnpm install
pnpm tauri dev
```

El primer arranque muestra la pantalla de configuración, que pide dos cosas:

- un **repositorio** — un remoto HTTPS que ya tengas, o el nombre de un repositorio nuevo de tickets para crear;
- un **token de acceso personal de GitHub** (clásico, con el permiso `repo`) — se usa para la API de GitHub (crear tableros, invitar colaboradores) y para repositorios privados. El token se guarda en el llavero del sistema operativo y nunca se escribe en disco.

Una vez conectado, pulsa `N` para crear tu primer ticket.

## Uso de la aplicación

| Acción | Cómo |
|---|---|
| Crear un ticket | `N`, o el botón **Nuevo ticket** |
| Buscar / navegar / sincronizar | `⌘K` (o `Ctrl+K`) |
| Copiar el id de un ticket | Abre un ticket y pulsa `Y` (copia el id del último ticket visto) |
| Copiar un ticket para un asistente de IA | **Copiar para IA** dentro del ticket |
| Cambiar entre tablero y grafo | El selector **Tablero / Grafo** de la cabecera, o `G` `K` / `G` `G` |
| Cambiar de tema | Los tres botones de tema de la cabecera |
| Cambiar de tablero | El menú de proyectos de la cabecera |
| Sincronizar ahora | El botón de sincronizar de la cabecera (*Sincronizar*); las ediciones también se sincronizan solas |
| Cambiar de idioma | El selector **EN / ES** de la cabecera |

Los ids de ticket son cortos (`TKT-1042`), así que resultan baratos de pegar en un mensaje de commit, en un chat o en un prompt.

## Dónde viven tus datos

```
~/.gitteam/
  .active                      id del proyecto activo
  projects/
    <project-id>/
      config.json              URL del remoto, nombre/email de git, última sincronización (nunca el token)
      repo/                    el checkout de Git — aquí viven los archivos .md de los tickets
```

Un directorio por repositorio, de modo que los proyectos nunca comparten checkout ni credencial. `project-id` se deriva del nombre del repositorio (en minúsculas, con `-2`, `-3` añadidos si hay colisión). El token de un proyecto vive en el llavero del sistema bajo el servicio `gitteam/<project-id>`.

Si no existe una entrada multi-proyecto, la aplicación recurre al diseño original de un solo proyecto (`~/.gitteam-data/` y `~/.gitteam-config.json`), de modo que las configuraciones anteriores siguen funcionando.

## Formato de un ticket

```markdown
---
id: TKT-1042
title: "Actualizar el parser de CSV para UTF-16"
status: "in-progress"
assignee: "carlos-dev"
priority: "high"
tags: ["backend", "python", "data"]
links: ["TKT-1039", "TKT-1002"]
last_updated: "2026-10-13T11:00:00Z"
---

# Contexto
El parser actual falla con archivos CSV en UTF-16.

# Requisitos
- Detectar la codificación antes de procesar
- Mantener la complejidad algorítmica en O(n)
```

Los nombres de archivo siguen `{id}-{slug}.md`, por ejemplo `TKT-1042-actualizar-el-parser-de-csv-para-utf-16.md`. Los ids empiezan en `TKT-1000`.

`links` es opcional y solo se escribe cuando el ticket tiene enlaces, así que los archivos existentes nunca se reescriben para añadir una clave vacía. Un enlace apunta al id de otro ticket; el grafo dibuja una arista no dirigida por cada pareja enlazada, de modo que `A → B` y `B → A` son una sola arista. Los enlaces a tickets que no existen se ignoran.

Los archivos Markdown del checkout sin frontmatter (un `README.md`, notas, un `AGENTS.md`) no son tickets y se omiten.

## Arquitectura

```text
┌──────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript + Vite                                │
│  store de Zustand · react-markdown · cmdk · tokens CSS       │
└─────────────────────────────┬────────────────────────────────┘
                              │ invoke() sobre IPC de Tauri
┌─────────────────────────────┴────────────────────────────────┐
│  Backend en Rust (Tauri 2) — 40 comandos                     │
│  tickets · git · conflictos · grafo · tableros · invitaciones│
│  keyring para credenciales · tokio para subprocesos          │
└─────────────────────────────┬────────────────────────────────┘
                              │ std::process::Command
┌─────────────────────────────┴────────────────────────────────┐
│  CLI de Git                                                  │
│  credencial inyectada por comando, nunca persistida          │
└─────────────────────────────┬────────────────────────────────┘
                              │ HTTPS
                              ▼
                    el repositorio de tickets compartido
```

El frontend nunca toca el sistema de archivos: toda lectura y escritura pasa por un comando de Rust, de modo que no se expone ningún permiso de `fs` a JavaScript.

## Modelo de seguridad

- **Almacenamiento del token.** El token de acceso personal vive en el llavero del sistema (Secret Service en Linux, Keychain en macOS, Credential Manager en Windows) bajo `gitteam/<project-id>`. Nunca se escribe en un archivo, ni se registra, ni se envía al frontend.
- **Uso del token.** Se inyecta por comando de Git mediante una sobreescritura `url.<con-credencial>.insteadOf=<limpia>` acotada a ese comando. El remoto configurado queda limpio, así que la credencial no se guarda en el `.git/config` del checkout ni sobrevive al comando.
- **Archivo de configuración.** `config.json` está junto al checkout, contiene solo la URL del remoto, la identidad de Git y la hora de la última sincronización, y nunca el token.
- **Redacción.** La salida de Git se limpia antes de llegar a un mensaje, así que una credencial presente en un comando fallido no puede aparecer en pantalla.
- **Sin telemetría.** El único tráfico saliente es hacia el remoto Git que configuraste y, cuando lo pides, hacia la API de GitHub.

## Generar un distribuible

| Objetivo | Comando | Salida |
|---|---|---|
| Linux | `pnpm build:linux` | `.AppImage` |
| macOS | `pnpm build:macos` | `.app` + `.dmg` |
| Windows | `pnpm build:windows` | Instaladores NSIS + MSI |
| Cualquiera (sin empaquetar) | `pnpm build:dev` | Binario de depuración, más rápido para iterar |

Cada objetivo debe compilarse en su propia plataforma.

## Desarrollo

```bash
pnpm tauri dev              # aplicación de escritorio con recarga en caliente
pnpm exec tsc --noEmit      # comprobación de tipos
pnpm build                  # comprobación de tipos + build de producción del frontend
cd src-tauri && cargo test  # 97 tests unitarios + 2 de integración
```

La suite de Rust cubre el ida y vuelta del frontmatter, el manejo de enlaces, las aristas del grafo, el driver de merge y el manejo de credenciales. Todavía no hay un runner de tests para el frontend; el frontend se verifica con `tsc` y un build de producción.

## Estructura del proyecto

```text
src/                    Frontend en React
  components/           tablero, grafo, configuración, conflictos, layout, primitivas de UI
  lib/                  envoltorios de comandos de Tauri, temas, atajos, avisos
  store/                store de Zustand
  types/                tipos de TypeScript
src-tauri/              Backend en Rust
  src/lib.rs            comandos de Tauri, integración con git y la suite de tests
  src/main.rs           Punto de entrada del binario (también aloja el driver de merge)
  capabilities/         ámbitos de permisos de Tauri 2
  icons/                Íconos de la aplicación, generados desde la marca
public/                 Recursos estáticos
```

## Fuera de alcance

- Colaboración en tiempo real (CRDT / Yjs): el modelo de sincronización es Git y es asíncrono a propósito.
- Clientes móviles.
- Adjuntos binarios.
- Control de tiempo.
- Un runner de tests para el frontend.

## Agradecimientos

Construido con [Tauri](https://tauri.app), [React](https://react.dev), [Vite](https://vitejs.dev), [Zustand](https://github.com/pmndrs/zustand), [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm), [cmdk](https://cmdk.paco.me), [lucide-react](https://lucide.dev) y el crate [`keyring`](https://github.com/open-source-cooperative/keyring-rs).

La interfaz es CSS plano impulsado por propiedades personalizadas: sin framework de CSS. Los enlaces entre tickets siguen la idea de los `[[wiki-link]]` de [Obsidian](https://obsidian.md), que también inspiró la vista de grafo.
