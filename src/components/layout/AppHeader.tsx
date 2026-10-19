import { useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  HelpCircle,
  LayoutGrid,
  Moon,
  Network,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../ui/Button";
import { BrandLockup } from "../ui/Brand";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useTicketsStore } from "../../store/tickets";
import { THEMES, THEME_LABELS, type Theme } from "../../lib/theme";

interface AppHeaderProps {
  onNewTicket: () => void;
}

const THEME_ICONS: Record<Theme, LucideIcon> = {
  default: Moon,
  light: Sun,
  obsidian: Sparkles,
};

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
  const removeActiveProject = useTicketsStore((s) => s.removeActiveProject);
  const openPalette = useTicketsStore((s) => s.openPalette);
  const openHelp = useTicketsStore((s) => s.openHelp);
  const viewMode = useTicketsStore((s) => s.viewMode);
  const setViewMode = useTicketsStore((s) => s.setViewMode);
  const theme = useTicketsStore((s) => s.theme);
  const setTheme = useTicketsStore((s) => s.setTheme);

  const relativeTime = useMemo(
    () => formatRelativeTime(lastSyncedAt),
    [lastSyncedAt],
  );

  const syncDisabled = syncStatus === "unconfigured" || syncStatus === "syncing";

  const indicator = (() => {
    switch (syncStatus) {
      case "syncing":
        return (
          <span className="flex items-center gap-1.5 text-fg-muted text-xs">
            <span className="relative inline-flex shrink-0">
              <span
                className="inline-block rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  background: "var(--status-progress)",
                }}
              />
              {/* Soft pulse ring — same color, expanding outward, fading out */}
              <span className="sync-pulse" />
            </span>
            Syncing
          </span>
        );
      case "synced":
        return (
          <span className="flex items-center gap-1 text-xs">
            <Check size={14} style={{ color: "var(--status-done)" }} />
            <span className="text-fg-muted">Synced</span>
            {relativeTime ? (
              <span className="text-fg-subtle">· {relativeTime}</span>
            ) : null}
          </span>
        );
      case "error":
        return (
          <span
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--priority-urgent)" }}
            title={syncError ?? "Sync error"}
          >
            <AlertCircle size={14} />
            Sync error
          </span>
        );
      case "conflict":
        return (
          <span
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--priority-high)" }}
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
    <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b bg-bg-subtle">
      <div className="flex items-center gap-3">
        <BrandLockup size={24} />
        {indicator}
        <div className="view-toggle" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={viewMode === "board"}
            onClick={() => setViewMode("board")}
            title="Board view (g then k)"
          >
            <LayoutGrid size={13} />
            Board
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "graph"}
            onClick={() => setViewMode("graph")}
            title="Graph view (g then g)"
          >
            <Network size={13} />
            Graph
          </button>
        </div>
        <div className="view-toggle" role="group" aria-label="Theme">
          {THEMES.map((option) => {
            const Icon = THEME_ICONS[option];
            const label = `${THEME_LABELS[option]} theme`;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={theme === option}
                aria-label={label}
                onClick={() => setTheme(option)}
                title={label}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Search button — opens the command palette and doubles as a discoverability hint. */}
        <button
          type="button"
          onClick={openPalette}
          className="search-trigger"
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

        <ProjectSwitcher />

        {syncStatus !== "unconfigured" ? (
          <Button
            variant="ghost"
            onClick={() => void removeActiveProject()}
            aria-label="Disconnect repository"
            title="Disconnect repository"
          >
            <Plug size={14} />
          </Button>
        ) : null}

        <button
          type="button"
          onClick={openHelp}
          className="btn-ghost"
          style={{ padding: 8 }}
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
