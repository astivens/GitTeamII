import { useMemo } from "react";
import { X } from "lucide-react";
import type { Ticket, TicketStatus } from "../../types/ticket";
import { useTicketsStore } from "../../store/tickets";
import { Column } from "./Column";

interface KanbanBoardProps {
  tickets: Ticket[];
  onSelect: (ticket: Ticket) => void;
}

const ALL_COLUMNS: Array<{
  status: TicketStatus;
  label: string;
  dotClass: string;
}> = [
  { status: "backlog", label: "Backlog", dotClass: "bg-status-backlog" },
  {
    status: "in-progress",
    label: "In Progress",
    dotClass: "bg-status-in-progress",
  },
  { status: "review", label: "Review", dotClass: "bg-status-review" },
  { status: "done", label: "Done", dotClass: "bg-status-done" },
];

const FILTER_LABEL: Record<TicketStatus, string> = {
  backlog: "Backlog",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
  archived: "Archived",
};

export function KanbanBoard({ tickets, onSelect }: KanbanBoardProps) {
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
        <div className="flex items-center justify-between px-4 py-2 text-xs text-fg-muted border-b border-border bg-bg">
          <span>
            Showing:{" "}
            <span className="text-fg font-medium">
              {FILTER_LABEL[statusFilter]}
            </span>
          </span>
          <button
            type="button"
            className="flex items-center gap-1 text-fg-muted hover:text-fg"
            onClick={() => setStatusFilter("all")}
          >
            <X size={12} />
            Clear filter
          </button>
        </div>
      ) : null}
      <div className="flex h-full gap-4 overflow-x-auto px-4 py-4">
        {columns.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            label={col.label}
            dotClass={col.dotClass}
            tickets={grouped[col.status]}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}