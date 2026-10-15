import { useState } from "react";
import type { Ticket, TicketPriority } from "../../types/ticket";

const priorityClass: Record<TicketPriority, string> = {
  low: "priority-dot-low",
  medium: "priority-dot-medium",
  high: "priority-dot-high",
  urgent: "priority-dot-urgent",
};

interface TicketCardProps {
  ticket: Ticket;
  onClick: () => void;
}

export function TicketCard({ ticket, onClick }: TicketCardProps) {
  const [dragging, setDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData("text/x-ticket-filename", ticket.filename);
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };

  const handleDragEnd = () => {
    setDragging(false);
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      className={`card card-hover w-full text-left p-3 focus-ring ${
        dragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`priority-dot ${priorityClass[ticket.priority]}`}
          aria-hidden="true"
        />
        <span className="font-mono text-xs text-fg-muted">{ticket.id}</span>
      </div>
      <p
        className="mt-1.5 text-sm font-medium text-fg line-clamp-2"
        style={{ lineHeight: 1.375 }}
      >
        {ticket.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {ticket.assignee ? (
          <span className="chip bg-bg-hover text-fg-muted border">
            @{ticket.assignee}
          </span>
        ) : null}
        {ticket.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="chip bg-bg-subtle text-fg-subtle border"
          >
            {tag}
          </span>
        ))}
      </div>
    </button>
  );
}
