import { useEffect, useState } from "react";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { pushToast } from "../../lib/toast";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";

interface InviteBoardModalProps {
  open: boolean;
  onClose: () => void;
  /** The board the invitation points at, for the title. */
  board: string;
}

/**
 * The invitation for a board: one string the user passes on through whatever
 * messenger they already have, plus the owner's other action — giving a GitHub
 * user access by name.
 *
 * The two go together because neither is enough on its own. The link carries no
 * credential and the board is private, so a link on its own reaches a clone that
 * fails; access on its own leaves the other person without the address to clone.
 * Saying both here is what keeps the flow from being discovered through an error.
 */
export function InviteBoardModal({ open, onClose, board }: InviteBoardModalProps) {
  const { t } = useI18n();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [username, setUsername] = useState("");
  const [granting, setGranting] = useState(false);
  const [grantMessage, setGrantMessage] = useState<string | null>(null);
  const [grantFailed, setGrantFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLink(null);
    setError(null);
    setCopied(false);
    setUsername("");
    setGrantMessage(null);
    setGrantFailed(false);
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
      pushToast(t.layout.invitationCopied, "success");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      pushToast(
        t.layout.couldNotCopy(e instanceof Error ? e.message : String(e)),
        "error",
      );
    }
  };

  const grant = async () => {
    setGranting(true);
    setGrantMessage(null);
    setGrantFailed(false);
    try {
      setGrantMessage(await api.boardInviteCollaborator(username));
      setUsername("");
    } catch (e) {
      setGrantFailed(true);
      setGrantMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setGranting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.layout.inviteTitle(board)}
      footer={
        <Button
          type="button"
          variant="primary"
          onClick={() => void copy()}
          disabled={!link}
        >
          {copied ? (
            <>
              <Check size={14} /> {t.common.copied}
            </>
          ) : (
            <>
              <Copy size={14} /> {t.layout.copyLink}
            </>
          )}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg-muted text-sm">
          {t.layout.inviteBlurb}
        </p>

        {link ? (
          <input
            className="input font-mono w-full"
            style={{ fontSize: "var(--text-xs)" }}
            value={link}
            readOnly
            spellCheck={false}
            aria-label={t.layout.invitationLink}
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--priority-urgent)" }}>
            {error}
          </p>
        ) : (
          <p className="text-fg-subtle text-sm flex items-center" style={{ gap: 8 }}>
            <Loader2 size={14} className="animate-spin" /> {t.layout.preparingLink}
          </p>
        )}

        <p className="text-fg-subtle text-xs">
          {t.layout.inviteNotAKey}
        </p>

        <div
          className="flex flex-col gap-2"
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          <p className="text-fg-muted text-sm">
            {t.layout.grantByUsernameHint}
          </p>
          <div className="flex items-center" style={{ gap: 8 }}>
            <input
              className="input flex-1 font-mono"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              placeholder="@ana-dev"
              autoComplete="off"
              spellCheck={false}
              aria-label={t.layout.githubUsername}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void grant()}
              disabled={username.trim().length === 0 || granting}
            >
              {granting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <UserPlus size={14} />
              )}
              {t.layout.giveAccess}
            </Button>
          </div>
          {grantMessage ? (
            <p
              className="text-xs"
              style={{
                color: grantFailed ? "var(--priority-urgent)" : "var(--fg-subtle)",
              }}
            >
              {grantMessage}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
