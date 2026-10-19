import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { CopyForAIButton } from "./CopyForAIButton";
import { useTicketsStore } from "../../store/tickets";
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

const STATUS_OPTIONS: Array<{ value: TicketStatus; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "in-progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
];

const PRIORITY_OPTIONS: Array<{ value: TicketPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

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
      pushToast("Title is required", "error");
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
        pushToast("Ticket created", "success");
      } else if (ticket) {
        await update(ticket.filename, input);
        pushToast("Ticket updated", "success");
      }
      onClose();
    } catch (e) {
      pushToast(
        `Error saving: ${e instanceof Error ? e.message : String(e)}`,
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
        `Could not link: ${e instanceof Error ? e.message : String(e)}`,
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
        `Could not unlink: ${e instanceof Error ? e.message : String(e)}`,
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
      title={mode === "create" ? "New ticket" : ticket ? `Edit ${ticket.id}` : "Edit ticket"}
      footer={
        <>
          {mode === "edit" && ticket ? (
            <div className="mr-auto flex items-center gap-2">
              <CopyForAIButton filename={ticket.filename} />
              {onDelete ? (
                <Button variant="ghost" onClick={onDelete} disabled={saving}>
                  Delete
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Input
        label="Title"
        value={state.title}
        onChange={(e) => updateField("title", e.currentTarget.value)}
        placeholder="Short, action-oriented summary"
        autoFocus
      />
      <div className="gap-3" style={gridStyle}>
        <Select
          label="Status"
          value={state.status}
          onChange={(e) =>
            updateField("status", e.currentTarget.value as TicketStatus)
          }
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          label="Priority"
          value={state.priority}
          onChange={(e) =>
            updateField("priority", e.currentTarget.value as TicketPriority)
          }
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="gap-3" style={gridStyle}>
        <Input
          label="Assignee"
          value={state.assignee}
          onChange={(e) => updateField("assignee", e.currentTarget.value)}
          placeholder="username (optional)"
        />
        <Input
          label="Tags"
          value={state.tags}
          onChange={(e) => updateField("tags", e.currentTarget.value)}
          placeholder="comma, separated"
        />
      </div>
      {mode === "edit" && ticket ? (
        <div className="flex flex-col gap-2">
          <span
            className="text-fg-muted text-xs font-medium"
            style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
          >
            Linked tickets
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {ticket.links.length === 0 ? (
              <span className="text-fg-subtle text-xs">
                No links yet — add a TKT id to draw an edge in the graph.
              </span>
            ) : (
              ticket.links.map((link) => (
                <span key={link} className="link-chip">
                  {link}
                  <button
                    type="button"
                    onClick={() => void handleUnlink(link)}
                    aria-label={`Unlink ${link}`}
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
              placeholder="TKT-1041"
              spellCheck={false}
              disabled={linkBusy}
            />
            <Button
              variant="outline"
              onClick={() => void handleLink()}
              disabled={linkBusy || linkInput.trim().length === 0}
            >
              Link
            </Button>
          </div>
          <span className="text-fg-subtle text-xs">
            Links save immediately — they are what the graph draws.
          </span>
        </div>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span
          className="text-fg-muted text-xs font-medium"
          style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
        >
          Body
        </span>
        <textarea
          className="input font-mono text-sm"
          style={{ minHeight: 180, lineHeight: 1.625, resize: "vertical" }}
          value={state.body}
          onChange={(e) => updateField("body", e.currentTarget.value)}
          placeholder="Markdown body — context, requirements, acceptance criteria…"
        />
      </label>
    </Modal>
  );
}
