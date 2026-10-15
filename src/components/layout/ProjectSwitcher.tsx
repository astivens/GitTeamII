import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { useTicketsStore } from "../../store/tickets";
import type { Project, SyncStatus } from "../../types/git";
import { pushToast } from "../../lib/toast";

/**
 * Project switcher — pill in the app header that opens an anchored dropdown
 * listing every linked repository. Lets the user switch the active project or
 * kick off the "link a new repository" flow.
 *
 * Sync state is currently global (one repo at a time syncs), so every row in
 * the picker shares the same dot color. Per-project sync is a future
 * enhancement — see the TODO in the row render.
 */
export function ProjectSwitcher() {
  const projects = useTicketsStore((s) => s.projects);
  const activeProject = useTicketsStore((s) => s.activeProject);
  const syncStatus = useTicketsStore((s) => s.syncStatus);
  const switchProject = useTicketsStore((s) => s.switchProject);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Close on Esc. We don't reuse `useGlobalShortcuts`' Esc handler because the
  // switcher is owned locally and may need to close even when a global modal
  // (like the ticket editor) is also mounted.
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus the filter input when the dropdown opens, reset the filter when it
  // closes so the next open starts clean.
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    setFilter("");
    return undefined;
  }, [open]);

  const filteredProjects = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.repo_url.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [projects, filter]);

  const dot = SYNC_DOT[syncStatus];

  const handleSelect = async (p: Project) => {
    if (p.id === activeProject?.id) {
      setOpen(false);
      return;
    }
    setOpen(false);
    try {
      await switchProject(p.id);
      pushToast(`Switched to ${p.name}`, "success");
    } catch (e) {
      pushToast(
        `Could not switch: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
  };

  const handleLinkNew = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("gitteam:link-new-repo"));
  };

  const handlePillKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  // ----- Empty state: no active project -----
  // We render a small "+ Link repository" pill instead of the full switcher
  // pill, because there's no project to summarize. Click forwards to the
  // setup screen via the global event so App.tsx can decide how to mount it.
  if (!activeProject) {
    return (
      <div ref={containerRef} className="relative">
        <button
          type="button"
          className="btn-outline"
          onClick={handleLinkNew}
          aria-label="Link a repository"
        >
          <Plus size={14} />
          <span>Link repository</span>
        </button>
      </div>
    );
  }

  const mono = monogram(activeProject.name);
  const repo = repoName(activeProject.repo_url);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="user-chip"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handlePillKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project: ${activeProject.name}`}
      >
        <Monogram text={mono} />
        <span className="font-mono font-semibold text-fg whitespace-nowrap">
          {activeProject.name}
        </span>
        <span
          aria-hidden="true"
          className="text-fg-subtle font-mono"
          style={{ fontSize: "var(--text-sm)" }}
        >
          /
        </span>
        <span
          className="font-mono text-fg-muted truncate"
          style={{ fontSize: "var(--text-sm)", maxWidth: 160 }}
          title={activeProject.repo_url}
        >
          {repo}
        </span>
        <span
          aria-label={dot.label}
          title={dot.label}
          className="status-dot"
          style={{ background: dot.color }}
        />
        <ChevronDown size={14} className="text-fg-muted" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Switch project"
          className="card animate-paletteIn flex flex-col"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            overflow: "hidden",
            zIndex: 50,
            boxShadow: "var(--shadow-elevated)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            // Anchor above the pill when there's no room below.
            // (CSS-only: we leave this for a follow-up; 380px fits fine for now.)
          }}
        >
          {/* Header — label + count */}
          <div
            className="flex items-center justify-between"
            style={{ padding: "12px 12px 6px" }}
          >
            <span
              className="text-fg-subtle font-medium uppercase"
              style={{ fontSize: 11, letterSpacing: "0.04em" }}
            >
              Switch project
            </span>
            <span
              className="font-mono text-fg-subtle"
              style={{ fontSize: 11 }}
            >
              {projects.length} linked
            </span>
          </div>

          {/* Filter input */}
          <div style={{ padding: "0 12px 8px" }}>
            <div
              className="flex items-center input"
              style={{ padding: "6px 10px", gap: 8 }}
            >
              <Search size={14} className="text-fg-subtle shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
                placeholder="Filter projects…"
                aria-label="Filter projects"
                className="palette-input"
                style={{ padding: 0 }}
              />
            </div>
          </div>

          {/* Project rows */}
          <div
            className="flex-1 overflow-auto"
            style={{ padding: "0 4px 4px", maxHeight: 320 }}
          >
            {filteredProjects.length === 0 ? (
              <div
                className="text-center text-fg-muted"
                style={{ padding: "24px 12px", fontSize: "var(--text-sm)" }}
              >
                {filter ? "No projects match." : "No projects yet."}
              </div>
            ) : (
              filteredProjects.map((p) => {
                const isActive = p.id === activeProject?.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    onClick={() => void handleSelect(p)}
                    className="w-full flex items-center text-left"
                    style={{
                      gap: 12,
                      padding: "8px 8px",
                      borderRadius: "var(--radius-md)",
                      border: isActive
                        ? "1px solid var(--accent)"
                        : "1px solid transparent",
                      background: isActive
                        ? "var(--accent-soft)"
                        : "transparent",
                      cursor: "pointer",
                      transition:
                        "background-color 120ms, border-color 120ms",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "var(--bg-hover)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    <Monogram text={monogram(p.name)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-semibold text-sm text-fg truncate">
                          {p.name}
                        </span>
                        {isActive ? (
                          <span
                            className="chip shrink-0"
                            style={{
                              background: "var(--accent-soft)",
                              color: "var(--accent)",
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                            }}
                          >
                            current
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="font-mono truncate"
                        style={{
                          fontSize: 11,
                          color: "var(--fg-subtle)",
                        }}
                        title={p.repo_url}
                      >
                        {p.repo_url}
                      </div>
                    </div>
                    {/* TODO(per-project-sync): read the dot color from a
                        per-project sync map once the backend exposes one. */}
                    <span
                      aria-label={dot.label}
                      title={dot.label}
                      className="status-dot shrink-0"
                      style={{ background: dot.color }}
                    />
                  </button>
                );
              })
            )}
          </div>

          {/* Divider + CTA */}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              padding: 8,
            }}
          >
            <button
              type="button"
              onClick={handleLinkNew}
              className="w-full flex items-center justify-between"
              style={{
                padding: "8px 10px",
                borderRadius: "var(--radius-md)",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
                border: 0,
                transition: "background-color 120ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent)";
                e.currentTarget.style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--accent-soft)";
                e.currentTarget.style.color = "var(--accent)";
              }}
            >
              <span
                className="flex items-center"
                style={{ gap: 8 }}
              >
                <Plus size={14} />
                Link new repository
              </span>
              <span className="kbd">⌘N</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ----- helpers ----- */

function Monogram({ text }: { text: string }) {
  return (
    <span
      className="flex items-center justify-center shrink-0"
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        background: "var(--accent)",
        color: "#ffffff",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        fontSize: 11,
        lineHeight: 1,
      }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

/**
 * Derive a 2-letter monogram from a project name.
 *   "Atlas App"      → "AA"
 *   "frontend"       → "FR"
 *   "design-system"  → "DE"
 *   ""               → "??"
 */
function monogram(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+/g, " ").trim();
  if (!cleaned) return "??";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0][0] ?? "") + (parts[1][0] ?? "")).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

/**
 * Show only the last path segment of a repo URL so the pill stays compact.
 *   "https://github.com/owner/atlas.git" → "atlas"
 */
function repoName(repoUrl: string): string {
  const trimmed = repoUrl.replace(/\.git$/, "").replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash === -1) return trimmed;
  return trimmed.slice(lastSlash + 1);
}

/* Color + label for the global sync dot. */
const SYNC_DOT: Record<SyncStatus, { color: string; label: string }> = {
  unconfigured: {
    color: "var(--status-backlog)",
    label: "Not configured",
  },
  syncing: {
    color: "var(--status-progress)",
    label: "Syncing…",
  },
  synced: {
    color: "var(--status-done)",
    label: "Synced",
  },
  error: {
    color: "var(--priority-urgent)",
    label: "Sync error",
  },
  conflict: {
    color: "var(--priority-urgent)",
    label: "Conflict",
  },
};