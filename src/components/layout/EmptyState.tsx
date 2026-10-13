import { Inbox } from "lucide-react";
import { Button } from "../ui/Button";

interface EmptyStateProps {
  onCreate: () => void;
}

export function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full bg-bg-subtle p-4 border border-border">
        <Inbox size={32} className="text-fg-muted" />
      </div>
      <div className="space-y-1">
        <p className="text-fg font-medium">No tickets yet</p>
        <p className="text-fg-muted text-sm">
          Create your first ticket to start working.
        </p>
      </div>
      <Button variant="primary" onClick={onCreate}>
        Create your first ticket
      </Button>
    </div>
  );
}