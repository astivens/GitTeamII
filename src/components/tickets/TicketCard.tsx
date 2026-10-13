import type { Ticket, TicketPriority } from "../../types/ticket";

const priorityColor: Record<TicketPriority, string> = {
  low: "bg-priority-low",
  medium: "bg-priority-medium",
  high: "bg-priority-high",
  urgent: "bg-priority-urgent",
};

interface TicketCardProps {
  ticket: Ticket;
  onClick: () => void;
}

export function TicketCard({ ticket, onClick }: TicketCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card w-full text-left p-3 hover:shadow-elevated hover:border-border-strong transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/40"
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${priorityColor[ticket.priority]}`}
          aria-hidden="true"
        />
        <span className="font-mono text-xs text-fg-muted">{ticket.id}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-fg line-clamp-2 leading-snug">
        {ticket.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {ticket.assignee ? (
          <span className="chip bg-bg-hover text-fg-muted border border-border">
            @{ticket.assignee}
          </span>
        ) : null}
        {ticket.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="chip bg-bg-subtle text-fg-subtle border border-border"
          >
            {tag}
          </span>
        ))}
      </div>
    </button>
  );
}