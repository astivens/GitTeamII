import { create } from "zustand";
import * as api from "../lib/tauri";
import { pushToast } from "../lib/toast";
import type { CreateTicketInput, Ticket } from "../types/ticket";
import type { GitConfig, SyncStatus } from "../types/git";

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

interface TicketsState {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  initialized: boolean;
  dataDir: string | null;

  // Sync state
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  gitConfig: GitConfig | null;
  remoteSha: string | null;
  pendingCommits: Set<string>;
  conflicts: string[];

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  create: (input: CreateTicketInput) => Promise<Ticket>;
  update: (filename: string, input: CreateTicketInput) => Promise<Ticket>;
  remove: (filename: string) => Promise<void>;
  select: (id: string | null) => void;
  getRawMarkdown: (filename: string) => Promise<string>;

  // Sync actions
  loadConfig: () => Promise<void>;
  setupRepo: (input: {
    url: string;
    pat: string;
    userName: string;
    userEmail: string;
  }) => Promise<void>;
  disconnectRepo: () => Promise<void>;
  syncNow: () => Promise<void>;
  flushNow: () => Promise<void>;
  startWatcher: () => Promise<void>;
  stopWatcher: () => Promise<void>;
  setRemoteSha: (sha: string | null) => void;

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
    initialized: false,
    dataDir: null,

    syncStatus: "unconfigured",
    syncError: null,
    lastSyncedAt: null,
    gitConfig: null,
    remoteSha: null,
    pendingCommits: new Set<string>(),
    conflicts: [],

    initialize: async () => {
      set({ loading: true, error: null });
      try {
        const dataDir = await api.initDataDir();
        const tickets = await api.listTickets();
        set({
          dataDir,
          tickets,
          initialized: true,
          loading: false,
          error: null,
        });
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
      const ticket = await api.createTicket(input);
      await get().refresh();
      const { gitConfig } = get();
      if (gitConfig) {
        commitTicketChange(ticket.filename, "create", gitConfig);
      }
      return ticket;
    },

    update: async (filename: string, input: CreateTicketInput) => {
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

    getRawMarkdown: async (filename: string) => {
      return api.readTicketRaw(filename);
    },

    loadConfig: async () => {
      try {
        const config = await api.gitGetConfig();
        if (!config) {
          set({
            syncStatus: "unconfigured",
            gitConfig: null,
            lastSyncedAt: null,
            syncError: null,
            remoteSha: null,
          });
          return;
        }
        set({ gitConfig: config, lastSyncedAt: config.last_sync_at });

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
            const setupResult = await api.gitSetupRepo(config, pat);
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

        // Load tickets from the data dir
        const dir = await api.initDataDir();
        const tickets = await api.listTickets();
        set({
          dataDir: dir,
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
      } catch (e) {
        set({
          syncStatus: "error",
          syncError: e instanceof Error ? e.message : String(e),
        });
      }
    },

    setupRepo: async (input) => {
      set({ syncStatus: "syncing", syncError: null });
      try {
        const config: GitConfig = {
          repo_url: input.url,
          git_user_name: input.userName,
          git_user_email: input.userEmail,
          last_sync_at: null,
        };
        const result = await api.gitSetupRepo(config, input.pat);
        set({
          syncStatus: "synced",
          gitConfig: result.config,
          lastSyncedAt: new Date().toISOString(),
          syncError: null,
        });
        const dir = await api.initDataDir();
        const tickets = await api.listTickets();
        set({
          dataDir: dir,
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ syncStatus: "error", syncError: msg });
        throw e;
      }
    },

    disconnectRepo: async () => {
      // Stop the watcher first so it doesn't race with the config deletion
      try {
        await get().stopWatcher();
      } catch {
        // ignore — best effort
      }
      // Cancel any pending debounced commits
      clearDebounce();
      try {
        await api.gitDeleteConfig();
      } catch {
        // ignore — best effort
      }
      set({
        syncStatus: "unconfigured",
        gitConfig: null,
        lastSyncedAt: null,
        syncError: null,
        remoteSha: null,
        pendingCommits: new Set<string>(),
        conflicts: [],
      });
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
  };
});

// Tiny shim to keep `eprintln`-style logging from the store in one place
// (mirrors Rust's eprintln for symmetry in dev).
function eprintln(label: string, value: unknown): void {
  const msg = value instanceof Error ? value.message : String(value);
  // eslint-disable-next-line no-console
  console.error(`[gitteam] ${label}: ${msg}`);
}
