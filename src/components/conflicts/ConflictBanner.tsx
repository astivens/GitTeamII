import { AlertTriangle, Wrench, XCircle } from "lucide-react";
import { Button } from "../ui/Button";
import { useTicketsStore } from "../../store/tickets";

interface ConflictBannerProps {
  onResolve: () => void;
}

export function ConflictBanner({ onResolve }: ConflictBannerProps) {
  const conflicts = useTicketsStore((s) => s.conflicts);
  const abortResolution = useTicketsStore((s) => s.abortResolution);

  const count = conflicts.length;
  const label =
    count === 0
      ? "All conflicts resolved — finish the rebase"
      : count === 1
        ? "1 file in conflict"
        : `${count} files in conflict`;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 px-4 py-2 border-b"
      style={{
        borderColor: "rgba(249, 115, 22, 0.3)",
        background: "rgba(249, 115, 22, 0.1)",
        color: "var(--priority-high)",
      }}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle size={16} />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={onResolve}
          aria-label="Open conflict resolution"
        >
          <Wrench size={14} />
          Resolve
        </Button>
        <Button
          variant="ghost"
          onClick={() => void abortResolution()}
          aria-label="Abort rebase"
          title="git rebase --abort"
        >
          <XCircle size={14} />
          Abort
        </Button>
      </div>
    </div>
  );
}
