import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { CopyForAIButton } from "./CopyForAIButton";
import { useTicketsStore } from "../../store/tickets";
import { useI18n } from "../../lib/i18n";
import { splitTags } from "../../lib/markdown";
import { pushToast } from "../../lib/toast";
import type { CreateTicketInput, Ticket, TicketPriority, TicketStatus } from "../../types/ticket";

interface TicketModalProps {
  open: boolean;
  mode: "create" | "edit";
  ticket: Ticket | null;
  onClose: () => void;
  onDelete: (() => void) | null;
}

// Stored values only — the labels come from the dictionary so the data written
// to the ticket frontmatter never changes with the language.
const STATUS_VALUES: TicketStatus[] = [
  "backlog",
  "in-progress",
  "review",
  "done",
  "archived",
];

const PRIORITY_VALUES: TicketPriority[] = ["low", "medium", "high", "urgent"];

interface FormState {
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee: string;
  tags: string;
  body: string;
}

function fromTicket(t: Ticket): FormState {
  return {
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee ?? "",
    tags: t.tags.join(", "),
    body: t.body,
  };
}

const EMPTY: FormState = {
  title: "",
  status: "backlog",
  priority: "medium",
  assignee: "",
  tags: "",
  body: "",
};

export function TicketModal({ open, mode, ticket, onClose, onDelete }: TicketModalProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const create = useTicketsStore((s) => s.create);
  const update = useTicketsStore((s) => s.update);
  const linkTickets = useTicketsStore((s) => s.linkTickets);
  const unlinkTickets = useTicketsStore((s) => s.unlinkTickets);

  const setLastViewedId = useTicketsStore((s) => s.setLastViewedId);

  // The `ticket` prop is re-derived from the store on every render (so link
  // changes show up live), which means its identity changes often. The form is
  // therefore only re-seeded when the modal opens or the *ticket id* changes —
  // never on a plain refresh, which would discard edits in progress.
  const latestTicket = useRef<Ticket | null>(ticket);
  latestTicket.current = ticket;
  const ticketId = ticket?.id ?? null;

  useEffect(() => {
    if (open) {
      const current = latestTicket.current;
      setState(current ? fromTicket(current) : EMPTY);
      setLinkInput("");
      // Track which ticket is currently viewed so the Y shortcut can yank its ID.
      setLastViewedId(current ? current.id : null);
    }
    return () => {
      if (open) setLastViewedId(null);
    };
  }, [open, ticketId, setLastViewedId]);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const title = state.title.trim();
    if (title.length === 0) {
      pushToast(t.tickets.titleRequired, "error");
      return;
    }
    const input: CreateTicketInput = {
      title,
      status: state.status,
      priority: state.priority,
      assignee: state.assignee.trim() ? state.assignee.trim() : null,
      tags: splitTags(state.tags),
      body: state.body,
    };
    setSaving(true);
    try {
      if (mode === "create") {
        await create(input);
        pushToast(t.tickets.created, "success");
      } else if (ticket) {
        await update(ticket.filename, input);
        pushToast(t.tickets.updated, "success");
      }
      onClose();
    } catch (e) {
      pushToast(
        t.tickets.saveError(e instanceof Error ? e.message : String(e)),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleLink = async () => {
    if (!ticket) return;
    const target = linkInput.trim().toUpperCase();
    if (target.length === 0) return;
    setLinkBusy(true);
    try {
      await linkTickets(ticket.id, target);
      setLinkInput("");
    } catch (e) {
      pushToast(
        t.tickets.linkError(e instanceof Error ? e.message : String(e)),
        "error",
      );
    } finally {
      setLinkBusy(false);
    }
  };

  const handleUnlink = async (target: string) => {
    if (!ticket) return;
    setLinkBusy(true);
    try {
      await unlinkTickets(ticket.id, target);
    } catch (e) {
      pushToast(
        t.tickets.unlinkError(e instanceof Error ? e.message : String(e)),
        "error",
      );
    } finally {
      setLinkBusy(false);
    }
  };

  const gridStyle = { display: "grid", gridTemplateColumns: "repeat(2, 1fr)" };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "create" ? t.tickets.newTicket : ticket ? t.tickets.editTicketId(ticket.id) : t.tickets.editTicket}
      footer={
        <>
          {mode === "edit" && ticket ? (
            <div className="mr-auto flex items-center gap-2">
              <CopyForAIButton filename={ticket.filename} />
              {onDelete ? (
                <Button variant="ghost" onClick={onDelete} disabled={saving}>
                  {t.common.delete}
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? t.tickets.saving : t.common.save}
          </Button>
        </>
      }
    >
      <Input
        label={t.tickets.title}
        value={state.title}
        onChange={(e) => updateField("title", e.currentTarget.value)}
        placeholder={t.tickets.titlePlaceholder}
        autoFocus
      />
      <div className="gap-3" style={gridStyle}>
        <Select
          label={t.tickets.statusLabel}
          value={state.status}
          onChange={(e) =>
            updateField("status", e.currentTarget.value as TicketStatus)
          }
        >
          {STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {t.tickets.status[value]}
            </option>
          ))}
        </Select>
        <Select
          label={t.tickets.priorityLabel}
          value={state.priority}
          onChange={(e) =>
            updateField("priority", e.currentTarget.value as TicketPriority)
          }
        >
          {PRIORITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {t.tickets.priority[value]}
            </option>
          ))}
        </Select>
      </div>
      <div className="gap-3" style={gridStyle}>
        <Input
          label={t.tickets.assignee}
          value={state.assignee}
          onChange={(e) => updateField("assignee", e.currentTarget.value)}
          placeholder={t.tickets.assigneePlaceholder}
        />
        <Input
          label={t.tickets.tags}
          value={state.tags}
          onChange={(e) => updateField("tags", e.currentTarget.value)}
          placeholder={t.tickets.tagsPlaceholder}
        />
      </div>
      {mode === "edit" && ticket ? (
        <div className="flex flex-col gap-2">
          <span
            className="text-fg-muted text-xs font-medium"
            style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
          >
            {t.tickets.linkedTickets}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {ticket.links.length === 0 ? (
              <span className="text-fg-subtle text-xs">
                {t.tickets.noLinks}
              </span>
            ) : (
              ticket.links.map((link) => (
                <span key={link} className="link-chip">
                  {link}
                  <button
                    type="button"
                    onClick={() => void handleUnlink(link)}
                    aria-label={t.tickets.unlink(link)}
                    disabled={linkBusy}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 font-mono text-sm"
              value={linkInput}
              onChange={(e) => setLinkInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleLink();
                }
              }}
              placeholder={t.tickets.linkPlaceholder}
              spellCheck={false}
              disabled={linkBusy}
            />
            <Button
              variant="outline"
              onClick={() => void handleLink()}
              disabled={linkBusy || linkInput.trim().length === 0}
            >
              {t.tickets.link}
            </Button>
          </div>
          <span className="text-fg-subtle text-xs">
            {t.tickets.linksNote}
          </span>
        </div>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span
          className="text-fg-muted text-xs font-medium"
          style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
        >
          {t.tickets.body}
        </span>
        <textarea
          className="input font-mono text-sm"
          style={{ minHeight: 180, lineHeight: 1.625, resize: "vertical" }}
          value={state.body}
          onChange={(e) => updateField("body", e.currentTarget.value)}
          placeholder={t.tickets.bodyPlaceholder}
        />
      </label>
    </Modal>
  );
}
