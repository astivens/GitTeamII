import { useMemo } from "react";
import { X } from "lucide-react";
import type { Ticket, TicketStatus } from "../../types/ticket";
import { useTicketsStore } from "../../store/tickets";
import { useI18n } from "../../lib/i18n";
import { Column } from "./Column";

interface KanbanBoardProps {
  tickets: Ticket[];
  onSelect: (ticket: Ticket) => void;
}

// `status` keys the stored frontmatter value; the visible label comes from the
// dictionary at render time.
const ALL_COLUMNS: Array<{
  status: TicketStatus;
  dotClass: string;
}> = [
  { status: "backlog", dotClass: "status-dot-backlog" },
  {
    status: "in-progress",
    dotClass: "status-dot-progress",
  },
  { status: "review", dotClass: "status-dot-review" },
  { status: "done", dotClass: "status-dot-done" },
];

export function KanbanBoard({ tickets, onSelect }: KanbanBoardProps) {
  const { t } = useI18n();
  const statusFilter = useTicketsStore((s) => s.statusFilter);
  const setStatusFilter = useTicketsStore((s) => s.setStatusFilter);

  const grouped = useMemo(() => {
    const m: Record<TicketStatus, Ticket[]> = {
      backlog: [],
      "in-progress": [],
      review: [],
      done: [],
      archived: [],
    };
    for (const t of tickets) {
      const bucket = m[t.status];
      if (bucket) bucket.push(t);
    }
    return m;
  }, [tickets]);

  const columns =
    statusFilter === "all"
      ? ALL_COLUMNS
      : ALL_COLUMNS.filter((c) => c.status === statusFilter);

  return (
    <div className="flex h-full flex-col">
      {statusFilter !== "all" ? (
        <div className="flex items-center justify-between px-4 py-2 text-xs text-fg-muted border-b bg-bg">
          <span>
            {t.tickets.showing}{" "}
            <span className="text-fg font-medium">
              {t.tickets.status[statusFilter]}
            </span>
          </span>
          <button
            type="button"
            className="filter-clear"
            onClick={() => setStatusFilter("all")}
          >
            <X size={12} />
            {t.tickets.clearFilter}
          </button>
        </div>
      ) : null}
      <div className="flex h-full gap-4 overflow-x-auto px-4 py-4">
        {columns.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            label={t.tickets.status[col.status]}
            dotClass={col.dotClass}
            tickets={grouped[col.status]}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
