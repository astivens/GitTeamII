/**
 * Copy for the project switcher: the pill in the header, its dropdown, and the
 * flows it starts — linking a repository and inviting someone to a board.
 *
 * The sync labels mirror the `SyncStatus` union, so the dictionary and the
 * status map cannot drift apart without the type check noticing.
 */
export const projects = {
  /** Pill label when no repository is linked yet. */
  linkRepository: "Link repository",
  /** Accessible name of that same pill. */
  linkARepository: "Link a repository",
  /** Accessible name of the pill that summarizes the active project. */
  projectLabel: (name: string) => `Project: ${name}`,
  /** Dropdown heading, also used as its accessible name. */
  switchProject: "Switch project",
  /** How many repositories the picker lists. */
  linked: (n: number) => `${n} linked`,
  filterPlaceholder: "Filter projects…",
  /** Accessible name of the filter input. */
  filterLabel: "Filter projects",
  noMatches: "No projects match.",
  noneYet: "No projects yet.",
  /** Badge on the row of the project that is currently open. */
  current: "current",
  inviteSomeone: "Invite someone",
  linkNewRepository: "Link new repository",
  /** Board name used in the invitation when there is no active project. */
  thisBoard: "this board",
  switchedTo: (name: string) => `Switched to ${name}`,
  /** `reason` is a backend message and is passed through untranslated. */
  couldNotSwitch: (reason: string) => `Could not switch: ${reason}`,
  /** Labels of the global sync dot, one per `SyncStatus`. */
  sync: {
    unconfigured: "Not configured",
    syncing: "Syncing…",
    synced: "Synced",
    error: "Sync error",
    conflict: "Conflict",
  },
};
