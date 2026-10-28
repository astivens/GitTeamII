import { useState } from "react";
import { useTicketsStore } from "../../store/tickets";
import { useI18n } from "../../lib/i18n";
import { pushToast } from "../../lib/toast";
import type { Ticket, TicketStatus } from "../../types/ticket";
import { TicketCard } from "./TicketCard";

interface ColumnProps {
  status: TicketStatus;
  label: string;
  dotClass: string;
  tickets: Ticket[];
  onSelect: (ticket: Ticket) => void;
}

export function Column({ status, label, dotClass, tickets, onSelect }: ColumnProps) {
  const { t } = useI18n();
  const [dragOver, setDragOver] = useState(false);
  const update = useTicketsStore((s) => s.update);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Only accept moves of our custom mime type — reject text selections etc.
    if (!e.dataTransfer.types.includes("text/x-ticket-filename")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const filename = e.dataTransfer.getData("text/x-ticket-filename");
    if (!filename) return;
    // The ticket being dragged comes from another column, so it is not in this
    // column's own `tickets` prop: resolve it against the whole board instead.
    const ticket = useTicketsStore
      .getState()
      .tickets.find((t) => t.filename === filename);
    if (!ticket) return;
    // Dropping on its own column is a silent no-op.
    if (ticket.status === status) return;
    try {
      await update(ticket.filename, {
        title: ticket.title,
        status,
        priority: ticket.priority,
        assignee: ticket.assignee,
        tags: ticket.tags,
        body: ticket.body,
      });
    } catch (err) {
      pushToast(
        t.tickets.moveError(err instanceof Error ? err.message : String(err)),
        "error",
      );
    }
  };

  return (
    <section
      className="flex h-full shrink-0 flex-col"
      style={{ width: 320 }}
    >
      <header className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={`status-dot ${dotClass}`}
            aria-hidden="true"
          />
          <h3 className="text-sm font-medium text-fg">{label}</h3>
        </div>
        <span className="chip bg-bg-elevated text-fg-muted border">
          {tickets.length}
        </span>
      </header>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`drop-zone flex-1 overflow-y-auto rounded-lg bg-bg-subtle border p-3 space-y-2 ${
          dragOver ? "is-dragover" : ""
        }`}
      >
        {tickets.length === 0 ? (
          <p
            className="text-fg-subtle text-xs text-center py-6"
            style={{ fontStyle: "italic" }}
          >
            {t.tickets.noTickets}
          </p>
        ) : (
          tickets.map((t) => (
            <TicketCard key={t.filename} ticket={t} onClick={() => onSelect(t)} />
          ))
        )}
      </div>
    </section>
  );
}
