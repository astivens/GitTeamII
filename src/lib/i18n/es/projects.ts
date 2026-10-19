import type { SameShape } from "../shape";

/**
 * Mirrors `src/lib/i18n/en/projects.ts`; every key added there must be translated here.
 * Copy of the project switcher: the header pill, its dropdown, and the flows it starts.
 */
export const projects: SameShape<(typeof import("../en/projects"))["projects"]> = {
  linkRepository: "Vincular repositorio",
  linkARepository: "Vincular un repositorio",
  projectLabel: (name: string) => `Proyecto: ${name}`,
  switchProject: "Cambiar de proyecto",
  linked: (n: number) => `${n} vinculados`,
  filterPlaceholder: "Filtrar proyectos…",
  filterLabel: "Filtrar proyectos",
  noMatches: "Ningún proyecto coincide.",
  noneYet: "Todavía no hay proyectos.",
  current: "actual",
  inviteSomeone: "Invitar a alguien",
  linkNewRepository: "Vincular repositorio nuevo",
  thisBoard: "este tablero",
  switchedTo: (name: string) => `Cambiado a ${name}`,
  /** `reason` es un mensaje del backend y se interpola sin traducir. */
  couldNotSwitch: (reason: string) => `No se pudo cambiar: ${reason}`,
  sync: {
    unconfigured: "Sin configurar",
    syncing: "Sincronizando…",
    synced: "Sincronizado",
    error: "Error de sincronización",
    conflict: "Conflicto",
  },
};
