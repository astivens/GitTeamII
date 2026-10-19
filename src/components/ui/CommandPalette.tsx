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
import { useI18n } from "../../lib/i18n";

interface CommandPaletteProps {
  /** Called when the user picks "Create new ticket" or a ticket to edit. */
  onCreateTicket: () => void;
  onEditTicket: (filename: string) => void;
}

export function CommandPalette({
  onCreateTicket,
  onEditTicket,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const open = useTicketsStore((s) => s.paletteOpen);
  const closePalette = useTicketsStore((s) => s.closePalette);
  const tickets = useTicketsStore((s) => s.tickets);
  const gitConfig = useTicketsStore((s) => s.gitConfig);
  const syncNow = useTicketsStore((s) => s.syncNow);
  const removeActiveProject = useTicketsStore((s) => s.removeActiveProject);
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

  // The filter labels are also the palette's search terms, so they follow the
  // language the user sees.
  const statusFilters: Array<{
    value: "all" | TicketStatus;
    label: string;
    icon: typeof Inbox;
  }> = [
    { value: "all", label: t.layout.showAllTickets, icon: ListTodo },
    { value: "backlog", label: t.layout.showBacklog, icon: Inbox },
    { value: "in-progress", label: t.layout.showInProgress, icon: CircleArrowRight },
    { value: "review", label: t.layout.showReview, icon: ScrollText },
    { value: "done", label: t.layout.showDone, icon: ListChecks },
  ];

  const filteredTickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((ticket) => {
      if (ticket.id.toLowerCase().includes(q)) return true;
      if (ticket.title.toLowerCase().includes(q)) return true;
      if (ticket.assignee && ticket.assignee.toLowerCase().includes(q)) return true;
      for (const tag of ticket.tags) {
        if (tag.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [tickets, query]);

  if (!open) return null;

  const separatorStyle = { margin: "4px 0", height: 1, background: "var(--border)" };

  return (
    <div
      className="flex justify-center"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        background: "rgba(0, 0, 0, 0.4)",
        paddingTop: 80,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <Command
        label={t.layout.paletteLabel}
        className="rounded-lg border bg-bg-elevated overflow-hidden animate-paletteIn"
        style={{ width: 640, maxWidth: "92vw", boxShadow: "var(--shadow-elevated)" }}
      >
        <div className="flex items-center border-b px-3">
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={t.layout.palettePlaceholder}
            className="palette-input"
          />
          <span className="kbd">Esc</span>
        </div>
        <Command.List
          className="overflow-y-auto p-1"
          style={{ maxHeight: 480 }}
        >
          <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">
            {t.layout.paletteNoMatches}
          </Command.Empty>

          <Command.Group heading={t.layout.paletteActions} className="palette-group">
            <Command.Item
              value="create new ticket"
              onSelect={() => {
                closePalette();
                onCreateTicket();
              }}
              className="palette-item"
            >
              <Sparkles size={14} className="text-fg-muted" />
              {t.layout.createNewTicket}
            </Command.Item>
            {hasGitConfig ? (
              <Command.Item
                value="sync now"
                onSelect={() => {
                  closePalette();
                  void syncNow();
                }}
                className="palette-item"
              >
                <RefreshCw size={14} className="text-fg-muted" />
                {t.layout.syncNow}
              </Command.Item>
            ) : null}
            {statusFilters.map((f) => {
              const Icon = f.icon;
              return (
                <Command.Item
                  key={f.value}
                  value={f.label}
                  onSelect={() => {
                    closePalette();
                    setStatusFilter(f.value);
                  }}
                  className="palette-item"
                >
                  <Icon size={14} className="text-fg-muted" />
                  {f.label}
                </Command.Item>
              );
            })}
          </Command.Group>

          <Command.Separator style={separatorStyle} />

          <Command.Group heading={t.layout.paletteTickets} className="palette-group">
            {filteredTickets.map((ticket) => {
              const tagLabel =
                ticket.tags.length > 0 ? ` ${ticket.tags.join(" ")}` : "";
              return (
                <Command.Item
                  key={ticket.filename}
                  value={`${ticket.id} ${ticket.title} ${ticket.assignee ?? ""}${tagLabel}`}
                  onSelect={() => {
                    closePalette();
                    onEditTicket(ticket.filename);
                  }}
                  className="palette-item"
                >
                  <Tag size={14} className="text-fg-muted shrink-0" />
                  <span className="font-mono text-xs text-fg-muted shrink-0">
                    {ticket.id}
                  </span>
                  <span className="text-sm text-fg truncate">{ticket.title}</span>
                  {ticket.tags.length > 0 ? (
                    <span
                      className="text-fg-subtle shrink-0"
                      style={{ fontSize: 11 }}
                    >
                      {ticket.tags
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
              <Command.Separator style={separatorStyle} />
              <Command.Group heading={t.layout.paletteSettings} className="palette-group">
                <Command.Item
                  value="disconnect repository"
                  onSelect={() => {
                    closePalette();
                    pushToast(t.layout.disconnecting, "default");
                    void removeActiveProject();
                  }}
                  className="palette-item"
                >
                  <Plug size={14} className="text-fg-muted" />
                  {t.layout.disconnectRepository}
                </Command.Item>
              </Command.Group>
            </>
          ) : null}
        </Command.List>
      </Command>
    </div>
  );
}
