import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, FileWarning, XCircle } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useTicketsStore } from "../../store/tickets";
import { pushToast } from "../../lib/toast";
import { useI18n } from "../../lib/i18n";
import {
  gitReadConflictVersion,
} from "../../lib/tauri";

interface ConflictModalProps {
  open: boolean;
  onClose: () => void;
}

type View =
  | { kind: "list" }
  | { kind: "resolve"; filename: string };

export function ConflictModal({ open, onClose }: ConflictModalProps) {
  const { t } = useI18n();
  const conflicts = useTicketsStore((s) => s.conflicts);
  const resolveConflict = useTicketsStore((s) => s.resolveConflict);
  const abortResolution = useTicketsStore((s) => s.abortResolution);
  const finishResolution = useTicketsStore((s) => s.finishResolution);

  const [view, setView] = useState<View>({ kind: "list" });
  const [localContent, setLocalContent] = useState<string>("");
  const [remoteContent, setRemoteContent] = useState<string>("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset to list view whenever the modal opens.
  useEffect(() => {
    if (open) {
      setView({ kind: "list" });
      setLocalContent("");
      setRemoteContent("");
      setPreviewError(null);
    }
  }, [open]);

  // When we enter resolve view for a file, fetch both versions.
  useEffect(() => {
    if (!open || view.kind !== "resolve") return;
    const filename = view.filename;
    let cancelled = false;
    setLocalContent("");
    setRemoteContent("");
    setPreviewError(null);
    void (async () => {
      try {
        const [local, remote] = await Promise.all([
          gitReadConflictVersion(filename, "local"),
          gitReadConflictVersion(filename, "remote"),
        ]);
        if (!cancelled) {
          setLocalContent(local);
          setRemoteContent(remote);
        }
      } catch (e) {
        if (!cancelled) {
          setPreviewError(
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, view]);

  const handleResolve = async (
    filename: string,
    resolution: "local" | "remote" | "both",
  ) => {
    setBusy(true);
    try {
      await resolveConflict(filename, resolution);
      // The store reloads `conflicts` automatically. If we picked "both" a new
      // file was created — the store will surface that via toast. After
      // successful resolution we always go back to the list view.
      setView({ kind: "list" });
    } catch (e) {
      pushToast(
        t.misc.conflicts.couldNotResolve(
          e instanceof Error ? e.message : String(e),
        ),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    setBusy(true);
    try {
      await finishResolution();
      onClose();
    } catch {
      // finishResolution already surfaces a toast
    } finally {
      setBusy(false);
    }
  };

  const handleAbort = async () => {
    setBusy(true);
    try {
      await abortResolution();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const title =
    view.kind === "list"
      ? t.misc.conflicts.title(conflicts.length)
      : t.misc.conflicts.resolveTitle(view.filename);

  const footer =
    view.kind === "list" ? (
      <>
        <div className="mr-auto">
          <Button
            variant="ghost"
            onClick={() => void handleAbort()}
            disabled={busy}
          >
            <XCircle size={14} />
            {t.misc.conflicts.abortRebase}
          </Button>
        </div>
        <Button
          variant="primary"
          onClick={() => void handleFinish()}
          disabled={busy || conflicts.length > 0}
          title={
            conflicts.length > 0
              ? t.misc.conflicts.finishBlocked
              : t.misc.conflicts.finishRebase
          }
        >
          {t.misc.conflicts.done} — {t.misc.conflicts.finishResolution}
        </Button>
      </>
    ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={footer}
      wide
    >
      {view.kind === "list" ? (
        <ConflictList
          conflicts={conflicts}
          onOpen={(filename) => setView({ kind: "resolve", filename })}
          onAbort={() => void handleAbort()}
          busy={busy}
        />
      ) : (
        <ConflictResolveView
          filename={view.filename}
          localContent={localContent}
          remoteContent={remoteContent}
          previewError={previewError}
          busy={busy}
          onBack={() => setView({ kind: "list" })}
          onAbort={() => void handleAbort()}
          onResolve={(resolution) => void handleResolve(view.filename, resolution)}
        />
      )}
    </Modal>
  );
}

interface ConflictListProps {
  conflicts: string[];
  onOpen: (filename: string) => void;
  onAbort: () => void;
  busy: boolean;
}

function ConflictList({ conflicts, onOpen, busy }: ConflictListProps) {
  const { t } = useI18n();
  if (conflicts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <FileWarning size={32} style={{ color: "var(--status-done)" }} />
        <p className="text-sm text-fg-muted">
          {t.misc.conflicts.allResolvedPrefix}
          <strong>{t.misc.conflicts.done}</strong>
          {t.misc.conflicts.allResolvedSuffix}
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-border rounded-md border bg-bg-subtle">
      {conflicts.map((filename) => (
        <li
          key={filename}
          className="flex items-center justify-between gap-3 px-3 py-2"
        >
          <span className="font-mono text-sm text-fg truncate" title={filename}>
            {filename}
          </span>
          <Button
            variant="outline"
            onClick={() => onOpen(filename)}
            disabled={busy}
          >
            {t.misc.conflicts.open}
          </Button>
        </li>
      ))}
    </ul>
  );
}

interface ConflictResolveViewProps {
  filename: string;
  localContent: string;
  remoteContent: string;
  previewError: string | null;
  busy: boolean;
  onBack: () => void;
  onAbort: () => void;
  onResolve: (resolution: "local" | "remote" | "both") => void;
}

function ConflictResolveView({
  filename,
  localContent,
  remoteContent,
  previewError,
  busy,
  onBack,
  onAbort,
  onResolve,
}: ConflictResolveViewProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft size={14} />
          {t.misc.conflicts.backToList}
        </Button>
        <Button
          variant="ghost"
          onClick={onAbort}
          disabled={busy}
          aria-label={t.misc.conflicts.abortRebase}
        >
          <XCircle size={14} />
          {t.misc.conflicts.abortRebase}
        </Button>
      </div>

      <p className="font-mono text-xs text-fg-subtle break-all">{filename}</p>

      {previewError ? (
        <p
          className="text-xs font-mono whitespace-pre-wrap"
          style={{ color: "var(--priority-urgent)" }}
        >
          {t.misc.conflicts.previewLoadError(previewError)}
        </p>
      ) : null}

      <div
        className="gap-3"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          minHeight: 280,
          maxHeight: "50vh",
        }}
      >
        <PreviewPanel
          title={t.misc.conflicts.local}
          content={localContent}
        />
        <PreviewPanel
          title={t.misc.conflicts.remote}
          content={remoteContent}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => onResolve("local")}
          disabled={busy}
        >
          {t.misc.conflicts.keepLocal}
        </Button>
        <Button
          variant="outline"
          onClick={() => onResolve("remote")}
          disabled={busy}
        >
          {t.misc.conflicts.keepRemote}
        </Button>
        <Button
          variant="primary"
          onClick={() => onResolve("both")}
          disabled={busy}
          title={t.misc.conflicts.keepBothHint}
        >
          {t.misc.conflicts.keepBoth}
        </Button>
      </div>
    </div>
  );
}

interface PreviewPanelProps {
  title: string;
  content: string;
}

function PreviewPanel({ title, content }: PreviewPanelProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col rounded-md border bg-bg-subtle overflow-hidden">
      <div className="px-3 py-1.5 border-b text-xs font-medium text-fg-muted bg-bg-elevated">
        {title}
      </div>
      <div className="flex-1 overflow-auto p-3 text-sm">
        {content.length === 0 ? (
          <p className="text-fg-subtle" style={{ fontStyle: "italic" }}>
            {t.misc.conflicts.emptyPreview}
          </p>
        ) : (
          <div className="markdown-body">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
