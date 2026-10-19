/**
 * Copy that no single screen owns: conflict resolution, the ticket graph, and
 * the messages the store raises on its own.
 *
 * The store runs outside React and reads these through `msg()` at the moment it
 * raises a message, so it always speaks the language currently in effect.
 */
export const misc = {
  conflicts: {
    /** List view title; `count` is how many files are still in conflict. */
    title: (count: number) => `Resolve conflicts (${count})`,
    /** Single-file view title. */
    resolveTitle: (filename: string) => `Resolve ${filename}`,
    open: "Open",
    backToList: "Back to list",
    abort: "Abort",
    abortRebase: "Abort rebase",
    /** Shown when nothing is left; `done` names the button right below it. */
    allResolvedPrefix: "All conflicts resolved. Click ",
    done: "Done",
    allResolvedSuffix: " below to finish the rebase.",
    /** Second half of the "Done — finish resolution" button. */
    finishResolution: "finish resolution",
    /** Tooltip of that button while files remain unresolved. */
    finishBlocked: "Resolve every file before finishing",
    finishRebase: "Finish the rebase",
    /** `detail` is a backend message and is passed through untranslated. */
    couldNotResolve: (detail: string) => `Could not resolve: ${detail}`,
    previewLoadError: (detail: string) => `Could not load preview: ${detail}`,
    local: "Local (your changes)",
    remote: "Remote (their changes)",
    keepLocal: "Keep local",
    keepRemote: "Keep remote",
    keepBoth: "Keep both",
    /** The literal `<filename>` is part of the explanation, not a placeholder. */
    keepBothHint: "Keep both — saves the remote version as <filename>.remote.md",
    emptyPreview: "Empty",
    /** Banner label: the number of files left picks the wording. */
    bannerLabel: (count: number) =>
      count === 0
        ? "All conflicts resolved — finish the rebase"
        : count === 1
          ? "1 file in conflict"
          : `${count} files in conflict`,
    bannerResolve: "Resolve",
    bannerResolveAria: "Open conflict resolution",
  },
  graph: {
    filterPlaceholder: "Filter by id, title or tag…",
    showUnlinked: "Show unlinked tickets",
    hideUnlinked: "Hide unlinked tickets",
    /** Toggle label beside the eye icon. */
    unlinked: "Unlinked",
    relayout: "Re-layout",
    relayoutHint: "Re-run the layout",
    /** Node and link counters. */
    counts: (tickets: number, links: number) =>
      `${tickets} ${tickets === 1 ? "ticket" : "tickets"} · ` +
      `${links} ${links === 1 ? "link" : "links"}`,
    emptyTitle: "Nothing to map yet.",
    /** The `links:` key inside the hint is frontmatter, not copy. */
    emptyHintPrefix: "Link tickets with",
    emptyHintSuffix: "and they show up here as an edge.",
    canvasAria: "Ticket graph",
  },
  store: {
    /** Toasts and messages the zustand store raises outside React. */
    syncError: (detail: string) => `Sync error: ${detail}`,
    syncedTickets: (count: number) =>
      count === 1 ? "Synced 1 ticket" : `Synced ${count} tickets`,
    dataDirUninitialized:
      "Data directory is not initialized and no PAT is saved. Please reconnect.",
    removeProjectError: (detail: string) => `Could not remove project: ${detail}`,
    graphError: (detail: string) => `Could not build graph: ${detail}`,
    pulledCommits: (count: number) =>
      count === 1 ? "Pulled 1 commit" : `Pulled ${count} commits`,
    renumberedIds: (pairs: string) =>
      `Renumbered duplicate ticket ids: ${pairs}`,
    conflictsError: (detail: string) => `Could not load conflicts: ${detail}`,
    remoteSaved: (filename: string) => `Remote version saved as ${filename}`,
    resolveError: (detail: string) => `Could not resolve conflict: ${detail}`,
    conflictsResolved: "Conflicts resolved",
    finishError: (detail: string) => `Could not finish resolution: ${detail}`,
    abortError: (detail: string) => `Could not abort: ${detail}`,
    resolutionAborted: "Resolution aborted",
  },
};
