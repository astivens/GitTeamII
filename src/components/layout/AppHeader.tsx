import { useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  HelpCircle,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Avatar";
import { useTicketsStore } from "../../store/tickets";

interface AppHeaderProps {
  onNewTicket: () => void;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function AppHeader({ onNewTicket }: AppHeaderProps) {
  const syncStatus = useTicketsStore((s) => s.syncStatus);
  const syncError = useTicketsStore((s) => s.syncError);
  const lastSyncedAt = useTicketsStore((s) => s.lastSyncedAt);
  const syncNow = useTicketsStore((s) => s.syncNow);
  const disconnectRepo = useTicketsStore((s) => s.disconnectRepo);
  const gitConfig = useTicketsStore((s) => s.gitConfig);
  const openPalette = useTicketsStore((s) => s.openPalette);
  const openHelp = useTicketsStore((s) => s.openHelp);

  const relativeTime = useMemo(
    () => formatRelativeTime(lastSyncedAt),
    [lastSyncedAt],
  );

  const syncDisabled = syncStatus === "unconfigured" || syncStatus === "syncing";

  const indicator = (() => {
    switch (syncStatus) {
      case "syncing":
        return (
          <span className="flex items-center gap-1 text-fg-muted text-xs">
            <Loader2 size={14} className="animate-spin" />
            Syncing
          </span>
        );
      case "synced":
        return (
          <span className="flex items-center gap-1 text-xs">
            <Check size={14} className="text-status-done" />
            <span className="text-fg-muted">Synced</span>
            {relativeTime ? (
              <span className="text-fg-subtle">· {relativeTime}</span>
            ) : null}
          </span>
        );
      case "error":
        return (
          <span
            className="flex items-center gap-1 text-priority-urgent text-xs"
            title={syncError ?? "Sync error"}
          >
            <AlertCircle size={14} />
            Sync error
          </span>
        );
      case "conflict":
        return (
          <span
            className="flex items-center gap-1 text-priority-high text-xs"
            title={syncError ?? "Sync conflict"}
          >
            <AlertTriangle size={14} />
            Conflict
          </span>
        );
      case "unconfigured":
      default:
        return (
          <span className="flex items-center gap-1 text-fg-subtle text-xs">
            Not synced
          </span>
        );
    }
  })();

  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-border bg-bg-subtle">
      <div className="flex items-center gap-3">
        <span className="font-mono text-fg text-base font-semibold tracking-tight">
          GitTeam
        </span>
        {indicator}
      </div>
      <div className="flex items-center gap-2">
        {/* Search button — opens the command palette and doubles as a discoverability hint. */}
        <button
          type="button"
          onClick={openPalette}
          className="flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors"
        >
          <Search size={14} />
          <span>Search…</span>
          <span className="kbd">⌘K</span>
        </button>

        <Button
          variant="ghost"
          onClick={() => void syncNow()}
          disabled={syncDisabled}
          aria-label="Sync now"
        >
          <RefreshCw size={14} />
          Sync
        </Button>

        {gitConfig ? (
          <button
            type="button"
            onClick={openHelp}
            title={gitConfig.git_user_name}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors"
          >
            <Avatar name={gitConfig.git_user_name} size={22} />
            <span className="text-sm">{gitConfig.git_user_name}</span>
          </button>
        ) : null}

        {syncStatus !== "unconfigured" ? (
          <Button
            variant="ghost"
            onClick={() => void disconnectRepo()}
            aria-label="Disconnect repository"
            title="Disconnect repository"
          >
            <Plug size={14} />
          </Button>
        ) : null}

        <button
          type="button"
          onClick={openHelp}
          className="btn-ghost p-2"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          <HelpCircle size={14} />
        </button>

        <Button variant="primary" onClick={onNewTicket}>
          <Plus size={14} />
          New ticket
        </Button>
      </div>
    </header>
  );
}