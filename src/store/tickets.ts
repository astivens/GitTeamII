import { create } from "zustand";
import * as api from "../lib/tauri";
import type { CreateTicketInput, Ticket } from "../types/ticket";
import type { GitConfig, SyncStatus } from "../types/git";

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
}

export const useTicketsStore = create<TicketsState>((set, get) => {
  async function commitTicketChange(
    filename: string,
    action: string,
    config: GitConfig,
  ): Promise<void> {
    try {
      const result = await api.gitCommitTicket(filename, action, config);
      if (result.committed) {
        set({ lastSyncedAt: new Date().toISOString() });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ syncStatus: "error", syncError: msg });
      // Do NOT throw — the local change is already on disk.
    }
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
        await commitTicketChange(ticket.filename, "create", gitConfig);
      }
      return ticket;
    },

    update: async (filename: string, input: CreateTicketInput) => {
      const ticket = await api.updateTicket(filename, input);
      await get().refresh();
      const { gitConfig } = get();
      if (gitConfig) {
        await commitTicketChange(ticket.filename, "update", gitConfig);
      }
      return ticket;
    },

    remove: async (filename: string) => {
      await api.deleteTicket(filename);
      await get().refresh();
      const { gitConfig } = get();
      if (gitConfig) {
        await commitTicketChange(filename, "delete", gitConfig);
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ syncStatus: "error", syncError: msg });
        throw e;
      }
    },

    disconnectRepo: async () => {
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
      });
    },

    syncNow: async () => {
      const { gitConfig } = get();
      if (!gitConfig) return;
      set({ syncStatus: "syncing", syncError: null });
      try {
        await api.gitPull(gitConfig);
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
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("CONFLICT:") || msg.startsWith("REJECTED:")) {
          set({ syncStatus: "conflict", syncError: msg });
        } else {
          set({ syncStatus: "error", syncError: msg });
        }
      }
    },
  };
});
