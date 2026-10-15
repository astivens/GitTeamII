import { useState } from "react";
import type { Ticket, TicketPriority } from "../../types/ticket";
import { CopyForAIButton } from "./CopyForAIButton";

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
  const [copyHint, setCopyHint] = useState(false);

  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData("text/x-ticket-filename", ticket.filename);
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };

  const handleDragEnd = () => {
    setDragging(false);
  };

  const handleYank = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(ticket.id);
      setCopyHint(true);
      window.setTimeout(() => setCopyHint(false), 1400);
    } catch {
      // Clipboard write failed — silent. The Copy for AI button is still available.
    }
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
        {/* Y for yank — quick copy of the ticket ID to paste anywhere. */}
        <button
          type="button"
          onClick={handleYank}
          title="Copy ticket ID (Y)"
          aria-label={`Copy ticket ID ${ticket.id}`}
          className="shrink-0 inline-flex items-center justify-center font-mono"
          // The button is always visible to keep keyboard / SR access predictable;
          // on hover the bg shifts to accent and the label flips to confirm the copy.
          style={{
            width: 22,
            height: 18,
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: copyHint ? "var(--status-done)" : "transparent",
            color: copyHint ? "#ffffff" : "var(--fg-muted)",
            fontSize: 10,
            fontWeight: 600,
            transition: "background-color 120ms, color 120ms",
            opacity: 0.7,
          }}
          onMouseEnter={(e) => {
            if (!copyHint) {
              e.currentTarget.style.background = "var(--accent)";
              e.currentTarget.style.color = "#ffffff";
            }
          }}
          onMouseLeave={(e) => {
            if (!copyHint) {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--fg-muted)";
            }
          }}
        >
          {copyHint ? "✓" : "Y"}
        </button>
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
        {/* Spacer + copy-raw-for-AI as a quiet secondary action */}
        <CopyForAIButton filename={ticket.filename} compact />
      </div>
    </button>
  );
}