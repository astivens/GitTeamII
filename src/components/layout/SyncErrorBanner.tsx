import { useState } from "react";
import { AlertCircle, Check, Copy, RefreshCw } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Button } from "../ui/Button";
import { useTicketsStore } from "../../store/tickets";
import { pushToast } from "../../lib/toast";

/**
 * Persists the last sync failure on screen.
 *
 * The header badge only carries the message in a `title`, so a failed sync used
 * to look like a dead label with nothing to act on and nothing to report. The
 * text stays selectable and copyable here, which is what makes the failure
 * diagnosable at all.
 */
export function SyncErrorBanner() {
  const syncError = useTicketsStore((s) => s.syncError);
  const syncNow = useTicketsStore((s) => s.syncNow);
  const [copied, setCopied] = useState(false);

  if (!syncError) return null;

  const copy = async () => {
    const text = syncError;
    try {
      try {
        await writeText(text);
      } catch {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      pushToast("Could not copy the error to the clipboard", "error");
      return;
    }
    setCopied(true);
    pushToast("Sync error copied to the clipboard", "success");
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 px-4 py-2 border-b"
      style={{
        borderColor: "rgba(239, 68, 68, 0.3)",
        background: "rgba(239, 68, 68, 0.1)",
        color: "var(--priority-urgent)",
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertCircle size={16} />
          <span>Sync failed</span>
        </div>
        <p
          className="mt-1 text-xs font-mono"
          style={{
            maxHeight: 96,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            opacity: 0.9,
          }}
        >
          {syncError}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          onClick={() => void copy()}
          aria-label="Copy the sync error"
          title="Copy the sync error"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          Copy
        </Button>
        <Button
          variant="ghost"
          onClick={() => void syncNow()}
          aria-label="Retry sync"
          title="Retry sync"
        >
          <RefreshCw size={14} />
          Retry
        </Button>
      </div>
    </div>
  );
}
