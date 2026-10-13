export type TicketStatus = "backlog" | "in-progress" | "review" | "done" | "archived";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface Ticket {
  id: string;
  title: string;
  status: TicketStatus;
  assignee: string | null;
  priority: TicketPriority;
  tags: string[];
  last_updated: string;
  body: string;
  filename: string;
  filepath: string;
}

export interface CreateTicketInput {
  title: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee?: string | null;
  tags?: string[];
  body?: string;
}