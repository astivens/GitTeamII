import { create } from "zustand";
import * as api from "../lib/tauri";
import {
  applyTheme,
  readStoredTheme,
  storeTheme,
  type Theme,
} from "../lib/theme";
import { pushToast } from "../lib/toast";
import type { CreateTicketInput, Ticket, TicketStatus } from "../types/ticket";
import type { Graph } from "../types/graph";
import type {
  AddProjectInput,
  BoardCreateInput,
  GitConfig,
  Project,
  SyncStatus,
} from "../types/git";

// ----- debounce (module-level so it survives across store actions) -----

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFiles: Set<string> = new Set();
const DEBOUNCE_MS = 2000;

function clearDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingFiles.clear();
}

function drainPending(): string[] {
  const files = Array.from(pendingFiles);
  pendingFiles.clear();
  return files;
}

/**
 * Derive a backwards-compatible `GitConfig` view from an active `Project`.
 * The `Project` type doesn't carry the git user identity, so the user fields
 * stay empty until the backend exposes them. New code should read from
 * `activeProject` directly.
 */
function projectToGitConfig(project: Project): GitConfig {
  return {
    repo_url: project.repo_url,
    git_user_name: "",
    git_user_email: "",
    last_sync_at: project.last_sync_at,
  };
}

interface TicketsState {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  /** Last ticket ID opened in the side panel/modal — used by the Y shortcut to know what to yank. */
  lastViewedId: string | null;
  initialized: boolean;

  // Project state (multi-project)
  projects: Project[];
  activeProject: Project | null;

  /**
   * @deprecated Derived from `activeProject`. Kept temporarily for components
   * that still read it directly. Will be removed once all call sites migrate
   * to `activeProject.id`.
   */
  dataDir: string | null;
  /**
   * @deprecated Derived from `activeProject`. Kept temporarily for components
   * that still read `git_user_name` / `repo_url` directly. Will be removed
   * once all call sites migrate to `activeProject`.
   */
  gitConfig: GitConfig | null;

  // Sync state
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  remoteSha: string | null;
  pendingCommits: Set<string>;
  conflicts: string[];

  // Fase 5 — UI state
  paletteOpen: boolean;
  paletteFocusQuery: string | null;
  helpOpen: boolean;
  statusFilter: "all" | TicketStatus;
  /** Transient: true right after a fresh setup, cleared on first create/update. */
  justSetup: boolean;

  // Fase 6 — view mode
  viewMode: "board" | "graph";
  setViewMode: (mode: "board" | "graph") => void;

  // Fase 6 — theme (local preference, mirrored to localStorage)
  theme: Theme;
  setTheme: (theme: Theme) => void;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  create: (input: CreateTicketInput) => Promise<Ticket>;
  update: (filename: string, input: CreateTicketInput) => Promise<Ticket>;
  remove: (filename: string) => Promise<void>;
  select: (id: string | null) => void;
  getRawMarkdown: (filename: string) => Promise<string>;

  // Project actions (replace loadConfig / setupRepo / disconnectRepo)
  loadProjects: () => Promise<void>;
  loadActiveProject: () => Promise<void>;
  addProject: (input: AddProjectInput) => Promise<Project>;
  createBoard: (input: BoardCreateInput) => Promise<Project>;
  adoptActiveProject: (project: Project) => Promise<Project>;
  removeProject: (id: string) => Promise<void>;
  removeActiveProject: () => Promise<void>;
  switchProject: (id: string) => Promise<Project>;

  // Graph (Fase 6F)
  graph: Graph | null;
  loadGraph: () => Promise<void>;
  linkTickets: (from: string, to: string) => Promise<void>;
  unlinkTickets: (from: string, to: string) => Promise<void>;

  // Sync actions
  syncNow: () => Promise<void>;
  flushNow: () => Promise<void>;
  startWatcher: () => Promise<void>;
  stopWatcher: () => Promise<void>;
  setRemoteSha: (sha: string | null) => void;

  // Fase 5 — UI actions
  openPalette: () => void;
  closePalette: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  setStatusFilter: (filter: "all" | TicketStatus) => void;
  markJustSetup: () => void;
  clearJustSetup: () => void;
  setLastViewedId: (id: string | null) => void;

  // Conflict resolution actions (Fase 4)
  loadConflicts: () => Promise<void>;
  resolveConflict: (
    filename: string,
    resolution: "local" | "remote" | "both",
  ) => Promise<void>;
  finishResolution: () => Promise<void>;
  abortResolution: () => Promise<void>;
}

export const useTicketsStore = create<TicketsState>((set, get) => {
  async function flushPendingCommits(files: string[]): Promise<void> {
    if (files.length === 0) return;
    const { gitConfig } = get();
    if (!gitConfig) {
      // Config was cleared mid-debounce — drop the pending set silently.
      return;
    }
    set({ syncStatus: "syncing", syncError: null });
    let successCount = 0;
    let lastError: string | null = null;
    for (const file of files) {
      try {
        const result = await api.gitCommitTicket(file, "sync", gitConfig);
        if (result.committed) {
          successCount += 1;
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        // Continue with the rest of the batch
      }
    }
    if (successCount > 0) {
      set({ lastSyncedAt: new Date().toISOString() });
    }
    if (lastError) {
      set({ syncStatus: "error", syncError: lastError });
      pushToast(`Sync error: ${lastError}`, "error");
    } else {
      set({ syncStatus: "synced", syncError: null });
      if (successCount > 0) {
        const label =
          successCount === 1 ? "Synced 1 ticket" : `Synced ${successCount} tickets`;
        pushToast(label, "success");
      }
    }
  }

  function commitTicketChange(
    filename: string,
    action: string,
    _config: GitConfig,
  ): void {
    // We don't need `action` anymore — each commit is "sync" and the filename
    // identifies the ticket. But we keep the signature for clarity at call sites.
    void _config;
    void action;
    pendingFiles.add(filename);
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      const toCommit = drainPending();
      debounceTimer = null;
      // Reflect drained set in store state so the UI shows "Syncing…"
      set({ pendingCommits: new Set() });
      void flushPendingCommits(toCommit);
    }, DEBOUNCE_MS);
    // Mirror the pending set so external listeners (e.g. App.tsx) can read it.
    set({ pendingCommits: new Set(pendingFiles) });
  }

  return {
    tickets: [],
    loading: false,
    error: null,
    selectedId: null,
    lastViewedId: null,
    initialized: false,

    projects: [],
    activeProject: null,

    graph: null,

    // Deprecated — derived from activeProject in loadActiveProject / addProject.
    dataDir: null,
    gitConfig: null,

    syncStatus: "unconfigured",
    syncError: null,
    lastSyncedAt: null,
    remoteSha: null,
    pendingCommits: new Set<string>(),
    conflicts: [],

    // Fase 5 — UI state defaults
    paletteOpen: false,
    paletteFocusQuery: null,
    helpOpen: false,
    statusFilter: "all",
    justSetup: false,

    viewMode: "board",
    theme: readStoredTheme(),

    initialize: async () => {
      set({ loading: true, error: null });
      try {
        // Backwards-compat shim: the old flow did `initDataDir` + `listTickets`
        // up front. With multi-project the data dir is project-scoped, so we
        // delegate to `loadProjects` which knows about the active project.
        await get().loadProjects();
      } catch (e) {
        set({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    refresh: async () => {
      try {
        const tickets = await api.listTickets();
        set({ tickets, error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

    create: async (input: CreateTicketInput) => {
      // Clear the onboarding flag on the first ticket the user creates.
      set({ justSetup: false });
      const ticket = await api.createTicket(input);
      await get().refresh();
      const { gitConfig } = get();
      if (gitConfig) {
        commitTicketChange(ticket.filename, "create", gitConfig);
      }
      return ticket;
    },

    update: async (filename: string, input: CreateTicketInput) => {
      // Editing a ticket means the user has moved past onboarding.
      set({ justSetup: false });
      const ticket = await api.updateTicket(filename, input);
      await get().refresh();
      const { gitConfig } = get();
      if (gitConfig) {
        commitTicketChange(ticket.filename, "update", gitConfig);
      }
      return ticket;
    },

    remove: async (filename: string) => {
      await api.deleteTicket(filename);
      await get().refresh();
      const { gitConfig } = get();
      if (gitConfig) {
        commitTicketChange(filename, "delete", gitConfig);
      }
    },

    select: (id: string | null) => set({ selectedId: id }),
    setLastViewedId: (id: string | null) => set({ lastViewedId: id }),

    getRawMarkdown: async (filename: string) => {
      return api.readTicketRaw(filename);
    },

    loadProjects: async () => {
      set({ loading: true, error: null });
      try {
        const [projects, active] = await Promise.all([
          api.listProjects(),
          api.getActiveProject(),
        ]);
        set({ projects });

        if (!active) {
          // No project yet — user lands on the SetupScreen.
          set({
            activeProject: null,
            gitConfig: null,
            dataDir: null,
            syncStatus: "unconfigured",
            syncError: null,
            lastSyncedAt: null,
            remoteSha: null,
            tickets: [],
            initialized: true,
            loading: false,
          });
          return;
        }

        // Delegate the heavy init (health check, PAT recovery, ticket load,
        // watcher start) to loadActiveProject, which assumes an active
        // project is present.
        set({ activeProject: active });
        await get().loadActiveProject();
      } catch (e) {
        set({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          syncStatus: "error",
          syncError: e instanceof Error ? e.message : String(e),
        });
      }
    },

    loadActiveProject: async () => {
      const { activeProject } = get();
      if (!activeProject) {
        // Nothing to load — caller is misusing the action.
        return;
      }
      try {
        // Populate the deprecated fields from the active project so any
        // component still reading them keeps working during the transition.
        const derivedGitConfig = projectToGitConfig(activeProject);
        set({
          gitConfig: derivedGitConfig,
          dataDir: activeProject.id,
          lastSyncedAt: activeProject.last_sync_at,
        });

        // Try to recover the PAT so we can re-setup if the data dir is broken
        let pat: string | null = null;
        try {
          pat = await api.gitLoadPat();
        } catch {
          // No PAT saved — fall through
        }

        // Check whether the data dir is a healthy git repo
        let isHealthy = false;
        try {
          await api.gitStatus();
          isHealthy = true;
        } catch {
          isHealthy = false;
        }

        if (!isHealthy) {
          if (!pat) {
            set({
              syncStatus: "error",
              syncError:
                "Data directory is not initialized and no PAT is saved. Please reconnect.",
            });
            return;
          }
          try {
            // Reuse the legacy `git_setup_repo` path with the derived config +
            // recovered PAT. The Rust side re-runs clone/init for the active
            // project without affecting the project list.
            const legacyConfig: GitConfig = derivedGitConfig;
            const setupResult = await api.gitSetupRepo(legacyConfig, pat);
            set({
              gitConfig: setupResult.config,
              lastSyncedAt: new Date().toISOString(),
            });
          } catch (e) {
            set({
              syncStatus: "error",
              syncError: e instanceof Error ? e.message : String(e),
            });
            return;
          }
        }

        set({ syncStatus: "synced", syncError: null });

        // Load tickets for the active project
        const tickets = await api.listTickets();
        const isFirstRun = tickets.length === 0;
        set({
          tickets,
          initialized: true,
          loading: false,
        });

        // Start the background ls-remote watcher + seed the last known SHA
        try {
          await get().startWatcher();
          const sha = await api.gitCurrentRemoteSha();
          if (sha) {
            set({ remoteSha: sha });
          }
        } catch {
          // Non-fatal — the user can still sync manually
        }

        // Recovered first-run state (repo just cloned, no tickets yet) → show
        // the onboarding welcome card. Cleared on first create/update.
        if (isFirstRun) {
          set({ justSetup: true });
        }
      } catch (e) {
        set({
          syncStatus: "error",
          syncError: e instanceof Error ? e.message : String(e),
        });
      }
    },

    addProject: async (input: AddProjectInput): Promise<Project> => {
      set({ syncStatus: "syncing", syncError: null });
      try {
        return await get().adoptActiveProject(await api.addProject(input));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ syncStatus: "error", syncError: msg });
        throw e;
      }
    },

    // A board is a private tickets repository the backend creates on GitHub and
    // links through the same path as any other project, so once it exists
    // everything the frontend owes that state is identical to addProject.
    createBoard: async (input: BoardCreateInput): Promise<Project> => {
      set({ syncStatus: "syncing", syncError: null });
      try {
        return await get().adoptActiveProject(await api.boardCreate(input));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ syncStatus: "error", syncError: msg });
        throw e;
      }
    },

    // The backend makes a newly created project active. Everything the frontend
    // owes that state lives here: the refreshed list, the config, and the just
    // activated project's tickets plus its watcher.
    adoptActiveProject: async (project: Project): Promise<Project> => {
      const projects = await api.listProjects();
      set({
        projects,
        activeProject: project,
        gitConfig: projectToGitConfig(project),
        dataDir: project.id,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: "synced",
        syncError: null,
      });

      // Initialize the just-activated project: load tickets, start watcher.
      const tickets = await api.listTickets();
      set({
        tickets,
        initialized: true,
        loading: false,
      });
      try {
        await get().startWatcher();
        const sha = await api.gitCurrentRemoteSha();
        if (sha) {
          set({ remoteSha: sha });
        }
      } catch {
        // Non-fatal
      }
      // Welcome the user with the onboarding variant of EmptyState on first
      // run. Auto-clears on the first create/update call.
      if (tickets.length === 0) {
        set({ justSetup: true });
      }
      return project;
    },

    removeProject: async (id: string) => {
      const { activeProject } = get();
      const isActive = activeProject?.id === id;
      if (isActive) {
        // Stop watcher + cancel any in-flight debounced commits before we
        // tear down the underlying data dir.
        try {
          await get().stopWatcher();
        } catch {
          // ignore — best effort
        }
        clearDebounce();
      }
      try {
        await api.removeProject(id);
      } catch (e) {
        pushToast(
          `Could not remove project: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
        throw e;
      }
      // Refresh the list; if we removed the active one, the backend will
      // report `null` on the next `getActiveProject` call and we land back
      // on the unconfigured state.
      const projects = await api.listProjects();
      if (isActive) {
        const stillActive = await api.getActiveProject();
        if (!stillActive) {
          set({
            projects,
            activeProject: null,
            gitConfig: null,
            dataDir: null,
            syncStatus: "unconfigured",
            syncError: null,
            lastSyncedAt: null,
            remoteSha: null,
            tickets: [],
            pendingCommits: new Set<string>(),
            conflicts: [],
            justSetup: false,
          });
          return;
        }
        set({ projects, activeProject: stillActive });
        await get().loadActiveProject();
      } else {
        set({ projects });
      }
    },

    removeActiveProject: async () => {
      const { activeProject } = get();
      if (!activeProject) {
        // Nothing to do — user is already in the unconfigured state.
        return;
      }
      await get().removeProject(activeProject.id);
    },

    switchProject: async (id: string): Promise<Project> => {
      // Stop the watcher first so it doesn't race with the project switch.
      try {
        await get().stopWatcher();
      } catch {
        // ignore — best effort
      }
      // Cancel any pending debounced commits — they're tied to the old repo.
      clearDebounce();
      set({ syncStatus: "syncing", syncError: null });
      const project = await api.switchProject(id);
      const projects = await api.listProjects();
      set({
        projects,
        activeProject: project,
        gitConfig: projectToGitConfig(project),
        dataDir: project.id,
        lastSyncedAt: project.last_sync_at,
        remoteSha: null,
        pendingCommits: new Set<string>(),
        conflicts: [],
      });
      await get().loadActiveProject();
      return project;
    },

    loadGraph: async () => {
      try {
        const graph = await api.getGraph();
        set({ graph });
      } catch (e) {
        pushToast(
          `Could not build graph: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }
    },

    linkTickets: async (from, to) => {
      const ticket = await api.linkTickets(from, to);
      await get().refresh();
      await get().loadGraph();
      const { gitConfig } = get();
      if (gitConfig) {
        commitTicketChange(ticket.filename, "link", gitConfig);
      }
    },

    unlinkTickets: async (from, to) => {
      const ticket = await api.unlinkTickets(from, to);
      await get().refresh();
      await get().loadGraph();
      const { gitConfig } = get();
      if (gitConfig) {
        commitTicketChange(ticket.filename, "unlink", gitConfig);
      }
    },

    syncNow: async () => {
      const { gitConfig } = get();
      if (!gitConfig) return;
      set({ syncStatus: "syncing", syncError: null });
      try {
        const pullResult = await api.gitPull(gitConfig);
        const changed = await api.gitListLocalChanges();
        for (const file of changed) {
          await api.gitCommitTicket(file, "sync", gitConfig);
        }
        const tickets = await api.listTickets();
        set({
          tickets,
          syncStatus: "synced",
          lastSyncedAt: new Date().toISOString(),
          syncError: null,
          conflicts: [],
        });
        if (pullResult.commits_pulled > 0) {
          const label =
            pullResult.commits_pulled === 1
              ? "Pulled 1 commit"
              : `Pulled ${pullResult.commits_pulled} commits`;
          pushToast(label, "success");
        }
        if (pullResult.renamed_ids.length > 0) {
          // Two people created the same display id offline: the older ticket
          // kept it, the other one was renumbered and its links rewritten.
          const pairs = pullResult.renamed_ids
            .map((r) => `${r.from} → ${r.to}`)
            .join(", ");
          pushToast(`Renumbered duplicate ticket ids: ${pairs}`, "success");
          // The graph is keyed by display id, so it moved with them.
          await get().loadGraph();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("CONFLICT:") || msg.startsWith("REJECTED:")) {
          set({ syncStatus: "conflict", syncError: msg });
          // Populate the conflicts list so the UI can show what to resolve.
          void get().loadConflicts();
        } else {
          set({ syncStatus: "error", syncError: msg });
        }
      }
    },

    flushNow: async () => {
      // Cancel the debounce timer (if any) and drain immediately
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      const toCommit = drainPending();
      set({ pendingCommits: new Set() });
      await flushPendingCommits(toCommit);
    },

    startWatcher: async () => {
      try {
        await api.gitStartWatcher();
      } catch (e) {
        eprintln("[store] startWatcher failed", e);
      }
    },

    stopWatcher: async () => {
      try {
        await api.gitStopWatcher();
      } catch {
        // ignore
      }
    },

    setRemoteSha: (sha: string | null) => set({ remoteSha: sha }),

    loadConflicts: async () => {
      try {
        const list = await api.gitListConflicts();
        set({ conflicts: list });
      } catch (e) {
        // Non-fatal — keep the previous list and surface via toast
        pushToast(
          `Could not load conflicts: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }
    },

    resolveConflict: async (filename, resolution) => {
      try {
        const newFile = await api.gitResolveConflict(filename, resolution);
        if (newFile) {
          pushToast(`Remote version saved as ${newFile}`, "success");
        }
        // Refresh tickets so the new file (if any) shows up, then reload the
        // conflicts list to see what's still unresolved.
        await get().refresh();
        const list = await api.gitListConflicts();
        set({ conflicts: list });
        if (list.length === 0) {
          // Nothing left to resolve — finish the rebase/merge automatically.
          await get().finishResolution();
        }
      } catch (e) {
        pushToast(
          `Could not resolve conflict: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
        throw e;
      }
    },

    finishResolution: async () => {
      try {
        await api.gitFinishResolution();
        await get().refresh();
        set({
          syncStatus: "synced",
          syncError: null,
          conflicts: [],
          lastSyncedAt: new Date().toISOString(),
        });
        pushToast("Conflicts resolved", "success");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ syncStatus: "error", syncError: msg });
        pushToast(`Could not finish resolution: ${msg}`, "error");
        throw e;
      }
    },

    abortResolution: async () => {
      try {
        await api.gitAbortResolution();
      } catch (e) {
        pushToast(
          `Could not abort: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
        return;
      }
      await get().refresh();
      set({
        syncStatus: "synced",
        syncError: null,
        conflicts: [],
      });
      pushToast("Resolution aborted", "default");
    },

    // ----- Fase 5 UI actions -----

    openPalette: () => set({ paletteOpen: true }),
    closePalette: () => set({ paletteOpen: false }),
    openHelp: () => set({ helpOpen: true }),
    closeHelp: () => set({ helpOpen: false }),
    setStatusFilter: (filter) => set({ statusFilter: filter }),
    markJustSetup: () => set({ justSetup: true }),
    clearJustSetup: () => set({ justSetup: false }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setTheme: (theme) => {
      applyTheme(theme);
      storeTheme(theme);
      set({ theme });
    },
  };
});

// Tiny shim to keep `eprintln`-style logging from the store in one place
// (mirrors Rust's eprintln for symmetry in dev).
function eprintln(label: string, value: unknown): void {
  const msg = value instanceof Error ? value.message : String(value);
  // eslint-disable-next-line no-console
  console.error(`[gitteam] ${label}: ${msg}`);
}
