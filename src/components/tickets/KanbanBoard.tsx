import { useMemo } from "react";
import type { Ticket } from "../../types/ticket";
import { Column } from "./Column";

interface KanbanBoardProps {
  tickets: Ticket[];
  onSelect: (ticket: Ticket) => void;
}

const COLUMNS: Array<{
  status: "backlog" | "in-progress" | "review" | "done";
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

export function KanbanBoard({ tickets, onSelect }: KanbanBoardProps) {
  const grouped = useMemo(() => {
    const m: Record<string, Ticket[]> = {
      backlog: [],
      "in-progress": [],
      review: [],
      done: [],
    };
    for (const t of tickets) {
      if (t.status === "archived") continue;
      const bucket = m[t.status];
      if (bucket) bucket.push(t);
    }
    return m;
  }, [tickets]);

  return (
    <div className="flex h-full gap-4 overflow-x-auto px-4 py-4">
      {COLUMNS.map((col) => (
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
  );
}