import type { SameShape } from "../shape";

/** Mirrors `src/lib/i18n/en/layout.ts`; every key added there must be translated here. */
export const layout: SameShape<(typeof import("../en/layout"))["layout"]> = {
  // Header — sync indicator
  syncing: "Sincronizando",
  synced: "Sincronizado",
  syncError: "Error de sincronización",
  syncConflict: "Conflicto de sincronización",
  conflict: "Conflicto",
  notSynced: "Sin sincronizar",

  // Header — view and theme toggles
  viewLabel: "Vista",
  boardView: "Tablero",
  boardViewHint: "Vista de tablero (g y luego k)",
  graphView: "Grafo",
  graphViewHint: "Vista de grafo (g y luego g)",
  themeLabel: "Tema",
  themeNames: {
    default: "Oscuro",
    light: "Claro",
    obsidian: "Obsidiana",
  },
  themeNamed: (name: string) => `Tema ${name}`,

  // Header — actions
  sync: "Sincronizar",
  syncNow: "Sincronizar ahora",
  disconnectRepository: "Desconectar repositorio",
  keyboardShortcuts: "Atajos de teclado",
  keyboardShortcutsHint: "Atajos de teclado (?)",
  newTicket: "Nuevo ticket",

  // Empty board
  boardIsEmpty: "El tablero está vacío.",
  dropTicket: "Suelta un ticket.",
  dropTicketClick: "o haz clic donde sea.",

  // First-run onboarding
  onboardingTitle: "Bienvenido a GitTeam",
  onboardingSubtitle:
    "Tu repositorio está conectado y listo. Tres pasos rápidos:",
  onboardingStep1: "Crea tu primer ticket",
  onboardingStep1Hint: "pulsa n",
  onboardingStep2: "El ticket se guarda en disco + se sincroniza con Git",
  onboardingStep3: "Pulsa Cmd+K para buscar, navegar y sincronizar",

  // No project linked
  whichRepo: "¿Qué repositorio hoy?",
  linkRepoHint: "Vincula uno para empezar a registrar tickets en él.",
  linkRepository: "Vincular repositorio",

  // No search results
  emptyQuery: "vacío",
  noMatches: (query: string) => `Sin resultados para ${query}`,
  noResultsHint:
    "Prueba la búsqueda difusa: fragmentos más cortos o más largos, etiquetas o números.",
  createNew: "Crear nuevo",

  // Disconnected repository
  repoLinkBroke: "Se rompió el enlace del repositorio",
  repoLinkBrokeHint:
    "El PAT caducó o el remoto cambió. Sincronización en pausa, tus ediciones están a salvo en local.",
  reconnect: "Reconectar",
  disconnect: "Desconectar",
  localFirstPromise: "Promesa local-first: tu trabajo nunca se pierde.",

  // Notices the shell pushes itself
  remoteChangesDetected: "Cambios remotos detectados — sincronizando…",
  notAnInvitation: "Ese enlace no es una invitación de GitTeam.",
  couldNotReadLink: (detail: string) => `No se pudo leer el enlace: ${detail}`,
  deleteTicketConfirm: (id: string) =>
    `¿Eliminar ${id}? Esta acción no se puede deshacer.`,
  ticketDeleted: "Ticket eliminado",
  deleteError: (detail: string) => `Error al eliminar: ${detail}`,
  failedToInitialize: (detail: string) => `No se pudo inicializar: ${detail}`,
  couldNotConnect: "No se pudo conectar al repositorio.",
  setUpAgain: "Configurar de nuevo",

  // Command palette
  paletteLabel: "Paleta de comandos global",
  palettePlaceholder: "Escribe un comando o busca tickets…",
  paletteNoMatches: "Sin resultados.",
  paletteActions: "Acciones",
  paletteTickets: "Tickets",
  paletteSettings: "Ajustes",
  createNewTicket: "Crear nuevo ticket",
  showAllTickets: "Ver todos los tickets",
  showBacklog: "Ver backlog",
  showInProgress: "Ver en curso",
  showReview: "Ver revisión",
  showDone: "Ver listos",
  disconnecting: "Desconectando…",

  // Invitation
  inviteTitle: (board: string) => `Invita a alguien a ${board}`,
  copyLink: "Copiar enlace",
  inviteBlurb:
    "Pasa este enlace por donde ya te comuniques — un mensaje, un correo. Quien lo pegue en GitTeam obtiene este tablero.",
  invitationLink: "Enlace de invitación",
  preparingLink: "Preparando el enlace…",
  inviteNotAKey:
    "El enlace no es una llave: este tablero es privado, así que la otra persona también necesita acceso al repositorio en GitHub.",
  grantByUsernameHint:
    "Otorga el acceso con su nombre de usuario de GitHub. GitHub le envía la invitación y su aplicación puede aceptarla sin esperar al correo.",
  githubUsername: "Nombre de usuario de GitHub",
  giveAccess: "Dar acceso",
  invitationCopied: "Invitación copiada",
  couldNotCopy: (detail: string) => `No se pudo copiar: ${detail}`,

  // Keyboard shortcuts (keys are consumed by `HelpOverlay`)
  shortcutOpenPalette: "Abrir la paleta de comandos",
  shortcutNewTicket: "Nuevo ticket",
  shortcutSearchTickets: "Buscar tickets",
  shortcutCopyLastTicketId: "Copiar el ID del último ticket visto",
  shortcutBoardView: "Vista de tablero",
  shortcutGraphView: "Vista de grafo",
  shortcutShowShortcuts: "Mostrar los atajos de teclado",
  shortcutCloseModal: "Cerrar el modal o el diálogo",
};
