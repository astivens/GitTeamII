import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { pushToast } from "../../lib/toast";
import * as api from "../../lib/tauri";

interface InviteBoardModalProps {
  open: boolean;
  onClose: () => void;
  /** The board the invitation points at, for the title. */
  board: string;
}

/**
 * The invitation for a board: one string the user passes on through whatever
 * messenger they already have. There is no server behind this and nothing is
 * sent anywhere by copying it — the link is the message, and the message is
 * theirs to send.
 *
 * The link carries no credential, and that is stated here because the
 * consequence matters: the board is private, so the link is not a key, and the
 * person receiving it still needs access to the repository on GitHub. Saying so
 * now beats letting them discover it through a clone that fails.
 */
export function InviteBoardModal({ open, onClose, board }: InviteBoardModalProps) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLink(null);
    setError(null);
    setCopied(false);
    let cancelled = false;
    void (async () => {
      try {
        const value = await api.boardInviteLink();
        if (!cancelled) setLink(value);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const copy = async () => {
    if (!link) return;
    try {
      await writeText(link);
      setCopied(true);
      pushToast("Invitation copied", "success");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      pushToast(
        `Could not copy: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Invite someone to ${board}`}
      footer={
        <Button
          type="button"
          variant="primary"
          onClick={() => void copy()}
          disabled={!link}
        >
          {copied ? (
            <>
              <Check size={14} /> Copied
            </>
          ) : (
            <>
              <Copy size={14} /> Copy link
            </>
          )}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg-muted text-sm">
          Pass this link through whatever you already use — a message, an email.
          Whoever pastes it into GitTeam gets this board.
        </p>

        {link ? (
          <input
            className="input font-mono w-full"
            style={{ fontSize: "var(--text-xs)" }}
            value={link}
            readOnly
            spellCheck={false}
            aria-label="Invitation link"
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--priority-urgent)" }}>
            {error}
          </p>
        ) : (
          <p className="text-fg-subtle text-sm flex items-center" style={{ gap: 8 }}>
            <Loader2 size={14} className="animate-spin" /> Preparing the link…
          </p>
        )}

        <p className="text-fg-subtle text-xs">
          The link is not a key: this board is private, so on the other side they
          also need access to the repository on GitHub.
        </p>
      </div>
    </Modal>
  );
}
