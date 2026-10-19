/**
 * The setup screen: the first face of the app when there is no board yet.
 *
 * The three paths share a shape — the label of the switch button, the heading of
 * the form it opens, its description and the labels of the fields only that path
 * shows — so the screen can index them by the mode it is currently in.
 */
export const setup = {
  modes: {
    connect: {
      button: "Connect a repository",
      heading: "Connect your team's repository",
      /**
       * The `~/.gitteam/projects/` path is shown as it is, so the sentence comes
       * in two parts with the path between them.
       */
      descriptionBefore: "GitTeam keeps a local copy under",
      descriptionAfter: "and keeps it in sync.",
      repositoryLabel: "Repository URL",
    },
    create: {
      button: "Create a board",
      heading: "Create a board",
      description:
        "GitTeam creates a private repository on GitHub that holds only tickets. Sharing a board is sharing that repository, so the repository holding your code is never involved.",
      boardNameLabel: "Board name",
      boardNamePlaceholder: "my-team-board",
      /** Suggestion built from the linked project, such as `acme-board`. */
      suggestedBoardName: (projectName: string) => `${projectName}-board`,
    },
    join: {
      button: "Join a board",
      heading: "Join a board",
      description:
        "Paste the invitation you were sent. GitTeam shows you which board it is for before it clones anything.",
      invitationLabel: "Invitation link",
      accessHint:
        "Your access has to be granted by whoever invited you: the link is not a key, and the board is private. If they already gave it to you by user name, GitTeam offers to accept the invitation here.",
    },
  },

  /** The card showing the invitation that was read, before a token is asked for. */
  invite: {
    board: "Board",
    unnamedBoard: "A board",
    invitedBy: (name: string) => ` · invited by ${name}`,
  },

  token: {
    label: "Personal access token",
    optionalLabel: "Personal access token (optional)",
    inheritedHint:
      "Leave it empty to reuse the token already saved for this project.",
    joinHint:
      "The board is private, so it clones with your own access to GitHub — the same token you would use to clone it by hand.",
    /**
     * Where to create one. GitHub's own `repo` scope name stays in a code tag
     * between these two parts.
     */
    scopeHintBefore:
      "GitHub → Settings → Developer settings → Personal access tokens (classic, with",
    scopeHintAfter: "scope)",
  },

  identity: {
    nameLabel: "Git user name",
    namePlaceholder: "Carlos Dev",
    emailLabel: "Git user email",
    emailPlaceholder: "carlos@example.com",
    inheritedHint:
      "Leave the name and email empty to reuse the ones already saved for this project.",
  },

  /** The invitation GitHub is holding for this account, offered right on the form. */
  pending: {
    holding: "GitHub is holding an invitation for you on",
    sentBy: (name: string) => ` · sent by ${name}`,
    after: ". A private board clones once it is accepted.",
    accept: "Accept and join",
  },

  actions: {
    submitConnect: "Test & Connect",
    submitCreate: "Create board",
    submitCheckLink: "Check link",
    submitJoin: "Join this board",
    busyCreate: "Creating…",
    busyChecking: "Checking…",
    busyConnect: "Testing & connecting…",
    back: "Back to my board",
  },

  /** Raised by this screen itself; git and backend diagnostics are shown as they arrive. */
  errors: {
    invitationRequired: "Paste the invitation link you were sent.",
    connectFailed: "Could not connect to the repository.",
    allFieldsRequired: "All fields are required.",
    createCredentialsRequired:
      "A token, a git user name and a git user email are required to create the first board.",
    joinCredentialsRequired:
      "Your own token, name and email are required: a private board clones with your credentials.",
  },

  toasts: {
    connected: (repo: string) => `Connected to ${repo}`,
    invitationAccepted: "Invitation accepted",
    created: (name: string) => `Created ${name}`,
  },
};
