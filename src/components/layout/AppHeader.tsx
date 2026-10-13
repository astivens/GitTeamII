import { Plus, RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";

interface AppHeaderProps {
  onNewTicket: () => void;
}

export function AppHeader({ onNewTicket }: AppHeaderProps) {
  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-border bg-bg-subtle">
      <div className="flex items-center gap-2">
        <span className="font-mono text-fg text-base font-semibold tracking-tight">
          GitTeam
        </span>
        <span className="chip bg-bg-elevated text-fg-subtle border border-border">
          Local
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          disabled
          title="Coming in Fase 2"
          aria-label="Sync (coming in Fase 2)"
        >
          <RefreshCw size={14} />
          Sync
        </Button>
        <Button variant="primary" onClick={onNewTicket}>
          <Plus size={14} />
          New ticket
        </Button>
      </div>
    </header>
  );
}