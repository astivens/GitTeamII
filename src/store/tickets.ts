import { create } from "zustand";
import * as api from "../lib/tauri";
import type { CreateTicketInput, Ticket } from "../types/ticket";

interface TicketsState {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  initialized: boolean;
  dataDir: string | null;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  create: (input: CreateTicketInput) => Promise<Ticket>;
  update: (filename: string, input: CreateTicketInput) => Promise<Ticket>;
  remove: (filename: string) => Promise<void>;
  select: (id: string | null) => void;
  getRawMarkdown: (filename: string) => Promise<string>;
}

export const useTicketsStore = create<TicketsState>((set, get) => ({
  tickets: [],
  loading: false,
  error: null,
  selectedId: null,
  initialized: false,
  dataDir: null,

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
    return ticket;
  },

  update: async (filename: string, input: CreateTicketInput) => {
    const ticket = await api.updateTicket(filename, input);
    await get().refresh();
    return ticket;
  },

  remove: async (filename: string) => {
    await api.deleteTicket(filename);
    await get().refresh();
  },

  select: (id: string | null) => set({ selectedId: id }),

  getRawMarkdown: async (filename: string) => {
    return api.readTicketRaw(filename);
  },
}));