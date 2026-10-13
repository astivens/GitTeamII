import { invoke } from "@tauri-apps/api/core";
import type { CreateTicketInput, Ticket } from "../types/ticket";

export async function initDataDir(): Promise<string> {
  return invoke<string>("init_data_dir");
}

export async function listTickets(): Promise<Ticket[]> {
  return invoke<Ticket[]>("list_tickets");
}

export async function readTicketRaw(filename: string): Promise<string> {
  return invoke<string>("read_ticket_raw", { filename });
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  return invoke<Ticket>("create_ticket", { input });
}

export async function updateTicket(
  filename: string,
  input: CreateTicketInput,
): Promise<Ticket> {
  return invoke<Ticket>("update_ticket", { filename, input });
}

export async function deleteTicket(filename: string): Promise<void> {
  await invoke<void>("delete_ticket", { filename });
}