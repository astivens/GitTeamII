import type { Ticket, TicketStatus } from "../../types/ticket";
import { TicketCard } from "./TicketCard";

interface ColumnProps {
  status: TicketStatus;
  label: string;
  dotClass: string;
  tickets: Ticket[];
  onSelect: (ticket: Ticket) => void;
}

export function Column({ label, dotClass, tickets, onSelect }: ColumnProps) {
  return (
    <section className="flex h-full w-[320px] shrink-0 flex-col">
      <header className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
            aria-hidden="true"
          />
          <h3 className="text-sm font-medium text-fg">{label}</h3>
        </div>
        <span className="chip bg-bg-elevated text-fg-muted border border-border">
          {tickets.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto rounded-lg bg-bg-subtle border border-border p-3 space-y-2">
        {tickets.length === 0 ? (
          <p className="text-fg-subtle text-xs italic text-center py-6">
            No tickets here
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