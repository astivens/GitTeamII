import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import {
  CircleArrowRight,
  Inbox,
  ListChecks,
  ListTodo,
  Plug,
  RefreshCw,
  ScrollText,
  Sparkles,
  Tag,
} from "lucide-react";
import { useTicketsStore } from "../../store/tickets";
import type { TicketStatus } from "../../types/ticket";
import { pushToast } from "../../lib/toast";

const STATUS_FILTERS: Array<{
  value: "all" | TicketStatus;
  label: string;
  icon: typeof Inbox;
}> = [
  { value: "all", label: "Show all tickets", icon: ListTodo },
  { value: "backlog", label: "Show backlog", icon: Inbox },
  { value: "in-progress", label: "Show in progress", icon: CircleArrowRight },
  { value: "review", label: "Show review", icon: ScrollText },
  { value: "done", label: "Show done", icon: ListChecks },
];

interface CommandPaletteProps {
  /** Called when the user picks "Create new ticket" or a ticket to edit. */
  onCreateTicket: () => void;
  onEditTicket: (filename: string) => void;
}

export function CommandPalette({
  onCreateTicket,
  onEditTicket,
}: CommandPaletteProps) {
  const open = useTicketsStore((s) => s.paletteOpen);
  const closePalette = useTicketsStore((s) => s.closePalette);
  const tickets = useTicketsStore((s) => s.tickets);
  const gitConfig = useTicketsStore((s) => s.gitConfig);
  const syncNow = useTicketsStore((s) => s.syncNow);
  const disconnectRepo = useTicketsStore((s) => s.disconnectRepo);
  const setStatusFilter = useTicketsStore((s) => s.setStatusFilter);

  // cmdk owns the query; lift it so we can filter tickets explicitly.
  const [query, setQuery] = useState("");

  // When the palette opens, consume any pending prefill from the keyboard
  // shortcut layer (e.g. `/` sets the query to "/" so it becomes part of the
  // search). When it closes, clear the local query so it starts fresh next
  // time.
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const prefill = useTicketsStore.getState().paletteFocusQuery;
    if (prefill !== null && prefill !== undefined) {
      setQuery(prefill);
      // Clear the flag so a second `/` press while open still works.
      useTicketsStore.setState({ paletteFocusQuery: null });
    }
  }, [open]);

  const hasGitConfig = gitConfig !== null;

  const filteredTickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) => {
      if (t.id.toLowerCase().includes(q)) return true;
      if (t.title.toLowerCase().includes(q)) return true;
      if (t.assignee && t.assignee.toLowerCase().includes(q)) return true;
      for (const tag of t.tags) {
        if (tag.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [tickets, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-20"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <Command
        label="Global command palette"
        className="w-[640px] max-w-[92vw] rounded-lg border border-border bg-bg-elevated shadow-elevated overflow-hidden animate-[palette-in_150ms_ease-out]"
      >
        <div className="flex items-center border-b border-border px-3">
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Type a command or search tickets…"
            className="flex-1 bg-transparent border-0 outline-none text-sm text-fg py-3 placeholder:text-fg-subtle"
          />
          <span className="kbd">Esc</span>
        </div>
        <Command.List className="max-h-[480px] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">
            No matches.
          </Command.Empty>

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle"
          >
            <Command.Item
              value="create new ticket"
              onSelect={() => {
                closePalette();
                onCreateTicket();
              }}
              className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-fg cursor-pointer aria-selected:bg-bg-hover"
            >
              <Sparkles size={14} className="text-fg-muted" />
              Create new ticket
            </Command.Item>
            {hasGitConfig ? (
              <Command.Item
                value="sync now"
                onSelect={() => {
                  closePalette();
                  void syncNow();
                }}
                className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-fg cursor-pointer aria-selected:bg-bg-hover"
              >
                <RefreshCw size={14} className="text-fg-muted" />
                Sync now
              </Command.Item>
            ) : null}
            {STATUS_FILTERS.map((f) => {
              const Icon = f.icon;
              return (
                <Command.Item
                  key={f.value}
                  value={f.label}
                  onSelect={() => {
                    closePalette();
                    setStatusFilter(f.value);
                  }}
                  className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-fg cursor-pointer aria-selected:bg-bg-hover"
                >
                  <Icon size={14} className="text-fg-muted" />
                  {f.label}
                </Command.Item>
              );
            })}
          </Command.Group>

          <Command.Separator className="my-1 h-px bg-border" />

          <Command.Group
            heading="Tickets"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle"
          >
            {filteredTickets.map((t) => {
              const tagLabel =
                t.tags.length > 0 ? ` ${t.tags.join(" ")}` : "";
              return (
                <Command.Item
                  key={t.filename}
                  value={`${t.id} ${t.title} ${t.assignee ?? ""}${tagLabel}`}
                  onSelect={() => {
                    closePalette();
                    onEditTicket(t.filename);
                  }}
                  className="flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer aria-selected:bg-bg-hover"
                >
                  <Tag size={14} className="text-fg-muted shrink-0" />
                  <span className="font-mono text-xs text-fg-muted shrink-0">
                    {t.id}
                  </span>
                  <span className="text-sm text-fg truncate">{t.title}</span>
                  {t.tags.length > 0 ? (
                    <span className="text-[11px] text-fg-subtle shrink-0">
                      {t.tags
                        .slice(0, 3)
                        .map((tag) => `#${tag}`)
                        .join(" ")}
                    </span>
                  ) : null}
                </Command.Item>
              );
            })}
          </Command.Group>

          {hasGitConfig ? (
            <>
              <Command.Separator className="my-1 h-px bg-border" />
              <Command.Group
                heading="Settings"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle"
              >
                <Command.Item
                  value="disconnect repository"
                  onSelect={() => {
                    closePalette();
                    pushToast("Disconnecting…", "default");
                    void disconnectRepo();
                  }}
                  className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-fg cursor-pointer aria-selected:bg-bg-hover"
                >
                  <Plug size={14} className="text-fg-muted" />
                  Disconnect repository
                </Command.Item>
              </Command.Group>
            </>
          ) : null}
        </Command.List>
      </Command>
    </div>
  );
}