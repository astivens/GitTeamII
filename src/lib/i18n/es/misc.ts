import type { SameShape } from "../shape";

/**
 * Mirrors `src/lib/i18n/en/misc.ts`; every key added there must be translated here.
 * Copy that no single screen owns: conflict resolution, the ticket graph, and
 * the messages the store raises on its own.
 */
export const misc: SameShape<(typeof import("../en/misc"))["misc"]> = {
  conflicts: {
    title: (count: number) => `Resolver conflictos (${count})`,
    resolveTitle: (filename: string) => `Resolver ${filename}`,
    open: "Abrir",
    backToList: "Volver a la lista",
    abort: "Abortar",
    abortRebase: "Abortar rebase",
    allResolvedPrefix: "Todos los conflictos están resueltos. Haz clic en ",
    done: "Hecho",
    allResolvedSuffix: " abajo para finalizar el rebase.",
    finishResolution: "finalizar resolución",
    finishBlocked: "Resuelve todos los archivos antes de finalizar",
    finishRebase: "Finalizar el rebase",
    /** `detail` es un mensaje del backend y se interpola sin traducir. */
    couldNotResolve: (detail: string) => `No se pudo resolver: ${detail}`,
    previewLoadError: (detail: string) =>
      `No se pudo cargar la vista previa: ${detail}`,
    local: "Local (tus cambios)",
    remote: "Remoto (sus cambios)",
    keepLocal: "Conservar local",
    keepRemote: "Conservar remoto",
    keepBoth: "Conservar ambos",
    keepBothHint:
      "Conservar ambos — guarda la versión remota como <filename>.remote.md",
    emptyPreview: "Vacío",
    bannerLabel: (count: number) =>
      count === 0
        ? "Todos los conflictos están resueltos — finaliza el rebase"
        : count === 1
          ? "1 archivo en conflicto"
          : `${count} archivos en conflicto`,
    bannerResolve: "Resolver",
    bannerResolveAria: "Abrir resolución de conflictos",
  },
  graph: {
    filterPlaceholder: "Filtrar por id, título o etiqueta…",
    showUnlinked: "Mostrar tickets sin vínculos",
    hideUnlinked: "Ocultar tickets sin vínculos",
    unlinked: "Sin vínculos",
    relayout: "Redistribuir",
    relayoutHint: "Volver a calcular la disposición",
    counts: (tickets: number, links: number) =>
      `${tickets} ${tickets === 1 ? "ticket" : "tickets"} · ` +
      `${links} ${links === 1 ? "vínculo" : "vínculos"}`,
    emptyTitle: "Todavía no hay nada que mapear.",
    emptyHintPrefix: "Vincula los tickets con",
    emptyHintSuffix: "y aparecerán aquí como una arista.",
    canvasAria: "Grafo de tickets",
  },
  store: {
    /** Avisos y mensajes que el store de zustand emite fuera de React. */
    syncError: (detail: string) => `Error de sincronización: ${detail}`,
    syncedTickets: (count: number) =>
      count === 1 ? "1 ticket sincronizado" : `${count} tickets sincronizados`,
    dataDirUninitialized:
      "El directorio de datos no está inicializado y no hay un PAT guardado. Vuelve a conectar.",
    removeProjectError: (detail: string) =>
      `No se pudo eliminar el proyecto: ${detail}`,
    graphError: (detail: string) => `No se pudo construir el grafo: ${detail}`,
    pulledCommits: (count: number) =>
      count === 1 ? "1 commit recibido" : `${count} commits recibidos`,
    renumberedIds: (pairs: string) =>
      `Ids de tickets duplicados renumerados: ${pairs}`,
    conflictsError: (detail: string) =>
      `No se pudieron cargar los conflictos: ${detail}`,
    remoteSaved: (filename: string) => `Versión remota guardada como ${filename}`,
    resolveError: (detail: string) =>
      `No se pudo resolver el conflicto: ${detail}`,
    conflictsResolved: "Conflictos resueltos",
    finishError: (detail: string) =>
      `No se pudo finalizar la resolución: ${detail}`,
    abortError: (detail: string) => `No se pudo abortar: ${detail}`,
    resolutionAborted: "Resolución abortada",
  },
};
