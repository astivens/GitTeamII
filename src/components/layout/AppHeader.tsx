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
import { LanguageSwitcher } from "../ui/LanguageSwitcher";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useTicketsStore } from "../../store/tickets";
import { useI18n } from "../../lib/i18n";
import type { Dictionary } from "../../lib/i18n/en";
import { THEMES, type Theme } from "../../lib/theme";

interface AppHeaderProps {
  onNewTicket: () => void;
}

const THEME_ICONS: Record<Theme, LucideIcon> = {
  default: Moon,
  light: Sun,
  obsidian: Sparkles,
};

/**
 * Formats the last sync time with the shared relative-time messages, so the
 * thresholds stay the same and only the wording follows the language.
 */
function formatRelativeTime(iso: string | null, t: Dictionary): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 5) return t.common.justNow;
  if (diffSec < 60) return t.common.secondsAgo(diffSec);
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t.common.minutesAgo(diffMin);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t.common.hoursAgo(diffHr);
  const diffDay = Math.floor(diffHr / 24);
  return t.common.daysAgo(diffDay);
}

export function AppHeader({ onNewTicket }: AppHeaderProps) {
  const { t } = useI18n();
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
    () => formatRelativeTime(lastSyncedAt, t),
    [lastSyncedAt, t],
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
            {t.layout.syncing}
          </span>
        );
      case "synced":
        return (
          <span className="flex items-center gap-1 text-xs">
            <Check size={14} style={{ color: "var(--status-done)" }} />
            <span className="text-fg-muted">{t.layout.synced}</span>
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
            title={syncError ?? t.layout.syncError}
          >
            <AlertCircle size={14} />
            {t.layout.syncError}
          </span>
        );
      case "conflict":
        return (
          <span
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--priority-high)" }}
            title={syncError ?? t.layout.syncConflict}
          >
            <AlertTriangle size={14} />
            {t.layout.conflict}
          </span>
        );
      case "unconfigured":
      default:
        return (
          <span className="flex items-center gap-1 text-fg-subtle text-xs">
            {t.layout.notSynced}
          </span>
        );
    }
  })();

  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b bg-bg-subtle">
      <div className="flex items-center gap-3">
        <BrandLockup size={24} />
        {indicator}
        <div className="view-toggle" role="group" aria-label={t.layout.viewLabel}>
          <button
            type="button"
            aria-pressed={viewMode === "board"}
            onClick={() => setViewMode("board")}
            title={t.layout.boardViewHint}
          >
            <LayoutGrid size={13} />
            {t.layout.boardView}
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "graph"}
            onClick={() => setViewMode("graph")}
            title={t.layout.graphViewHint}
          >
            <Network size={13} />
            {t.layout.graphView}
          </button>
        </div>
        <div className="view-toggle" role="group" aria-label={t.layout.themeLabel}>
          {THEMES.map((option) => {
            const Icon = THEME_ICONS[option];
            const label = t.layout.themeNamed(t.layout.themeNames[option]);
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
        <LanguageSwitcher />
      </div>
      <div className="flex items-center gap-2">
        {/* Search button — opens the command palette and doubles as a discoverability hint. */}
        <button
          type="button"
          onClick={openPalette}
          className="search-trigger"
        >
          <Search size={14} />
          <span>{t.common.search}</span>
          <span className="kbd">⌘K</span>
        </button>

        <Button
          variant="ghost"
          onClick={() => void syncNow()}
          disabled={syncDisabled}
          aria-label={t.layout.syncNow}
        >
          <RefreshCw size={14} />
          {t.layout.sync}
        </Button>

        <ProjectSwitcher />

        {syncStatus !== "unconfigured" ? (
          <Button
            variant="ghost"
            onClick={() => void removeActiveProject()}
            aria-label={t.layout.disconnectRepository}
            title={t.layout.disconnectRepository}
          >
            <Plug size={14} />
          </Button>
        ) : null}

        <button
          type="button"
          onClick={openHelp}
          className="btn-ghost"
          style={{ padding: 8 }}
          aria-label={t.layout.keyboardShortcuts}
          title={t.layout.keyboardShortcutsHint}
        >
          <HelpCircle size={14} />
        </button>

        <Button variant="primary" onClick={onNewTicket}>
          <Plus size={14} />
          {t.layout.newTicket}
        </Button>
      </div>
    </header>
  );
}
