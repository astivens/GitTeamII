/**
 * Copy for the app shell: the header, the empty states, the command palette,
 * the invitation modal, the help overlay and the notices the shell pushes.
 */
export const layout = {
  // Header — sync indicator
  syncing: "Syncing",
  synced: "Synced",
  syncError: "Sync error",
  syncConflict: "Sync conflict",
  conflict: "Conflict",
  notSynced: "Not synced",

  // Header — view and theme toggles
  viewLabel: "View",
  boardView: "Board",
  boardViewHint: "Board view (g then k)",
  graphView: "Graph",
  graphViewHint: "Graph view (g then g)",
  themeLabel: "Theme",
  themeNames: {
    default: "Dark",
    light: "Light",
    obsidian: "Obsidian",
  },
  /** Names a theme in a sentence, e.g. `themeNamed("Dark")` → "Dark theme". */
  themeNamed: (name: string) => `${name} theme`,

  // Header — actions
  sync: "Sync",
  syncNow: "Sync now",
  disconnectRepository: "Disconnect repository",
  keyboardShortcuts: "Keyboard shortcuts",
  keyboardShortcutsHint: "Keyboard shortcuts (?)",
  newTicket: "New ticket",

  // Empty board
  boardIsEmpty: "Board is empty.",
  dropTicket: "Drop a ticket.",
  dropTicketClick: "or click anywhere.",

  // First-run onboarding
  onboardingTitle: "Welcome to GitTeam",
  onboardingSubtitle: "Your repository is connected and ready. Three quick steps:",
  onboardingStep1: "Create your first ticket",
  onboardingStep1Hint: "press n",
  onboardingStep2: "The ticket saves to disk + syncs to Git",
  onboardingStep3: "Press Cmd+K to search, navigate, sync",

  // No project linked
  whichRepo: "Which repo today?",
  linkRepoHint: "Link one to start tracking tickets in it.",
  linkRepository: "Link repository",

  // No search results
  emptyQuery: "empty",
  noMatches: (query: string) => `No matches for ${query}`,
  noResultsHint: "Try fuzzy: shorter or longer fragments, tags, or numbers.",
  createNew: "Create new",

  // Disconnected repository
  repoLinkBroke: "Repo link broke",
  repoLinkBrokeHint:
    "PAT expired or remote moved. Sync paused, your edits are safe locally.",
  reconnect: "Reconnect",
  disconnect: "Disconnect",
  localFirstPromise: "Local-first promise: your work is never lost.",

  // Notices the shell pushes itself
  remoteChangesDetected: "Remote changes detected — syncing…",
  notAnInvitation: "That link is not a GitTeam invitation.",
  couldNotReadLink: (detail: string) => `Could not read that link: ${detail}`,
  deleteTicketConfirm: (id: string) =>
    `Delete ${id}? This cannot be undone.`,
  ticketDeleted: "Ticket deleted",
  deleteError: (detail: string) => `Error deleting: ${detail}`,
  failedToInitialize: (detail: string) => `Failed to initialize: ${detail}`,
  couldNotConnect: "Could not connect to the repository.",
  setUpAgain: "Set up again",

  // Command palette
  paletteLabel: "Global command palette",
  palettePlaceholder: "Type a command or search tickets…",
  paletteNoMatches: "No matches.",
  paletteActions: "Actions",
  paletteTickets: "Tickets",
  paletteSettings: "Settings",
  createNewTicket: "Create new ticket",
  showAllTickets: "Show all tickets",
  showBacklog: "Show backlog",
  showInProgress: "Show in progress",
  showReview: "Show review",
  showDone: "Show done",
  disconnecting: "Disconnecting…",

  // Invitation
  inviteTitle: (board: string) => `Invite someone to ${board}`,
  copyLink: "Copy link",
  inviteBlurb:
    "Pass this link through whatever you already use — a message, an email. Whoever pastes it into GitTeam gets this board.",
  invitationLink: "Invitation link",
  preparingLink: "Preparing the link…",
  inviteNotAKey:
    "The link is not a key: this board is private, so on the other side they also need access to the repository on GitHub.",
  grantByUsernameHint:
    "Give them access by their GitHub user name. GitHub sends them the invitation, and their app can accept it without waiting for the mail.",
  githubUsername: "GitHub user name",
  giveAccess: "Give access",
  invitationCopied: "Invitation copied",
  couldNotCopy: (detail: string) => `Could not copy: ${detail}`,

  // Keyboard shortcuts (keys are consumed by `HelpOverlay`)
  shortcutOpenPalette: "Open command palette",
  shortcutNewTicket: "New ticket",
  shortcutSearchTickets: "Search tickets",
  shortcutCopyLastTicketId: "Copy the last viewed ticket ID",
  shortcutBoardView: "Board view",
  shortcutGraphView: "Graph view",
  shortcutShowShortcuts: "Show keyboard shortcuts",
  shortcutCloseModal: "Close modal or dialog",
};
