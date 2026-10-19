export type TicketStatus = "backlog" | "in-progress" | "review" | "done" | "archived";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface Ticket {
  id: string;
  /**
   * Stable identity behind the display id. Optional because tickets written
   * before the scheme existed have none.
   */
  uid: string | null;
  title: string;
  status: TicketStatus;
  assignee: string | null;
  priority: TicketPriority;
  tags: string[];
  /** Related ticket ids, declared in frontmatter (`links: [TKT-1041]`). */
  links: string[];
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