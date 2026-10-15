import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { pushToast } from "../../lib/toast";
import { useTicketsStore } from "../../store/tickets";

interface CopyForAIButtonProps {
  filename: string;
  /** Compact mode — small ghost button next to tags. Defaults to false (full button). */
  compact?: boolean;
}

export function CopyForAIButton({ filename, compact = false }: CopyForAIButtonProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onClick = async () => {
    setBusy(true);
    try {
      const raw = await useTicketsStore.getState().getRawMarkdown(filename);
      await writeText(raw);
      setDone(true);
      pushToast("Contexto copiado al portapapeles", "success");
      window.setTimeout(() => setDone(false), 1500);
    } catch (e) {
      pushToast(
        `Error copying: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void onClick();
        }}
        disabled={busy}
        title="Copy full ticket markdown for AI context"
        aria-label="Copy ticket markdown for AI"
        className="shrink-0 inline-flex items-center gap-1 ml-auto font-mono"
        style={{
          height: 18,
          padding: "0 6px",
          borderRadius: 4,
          border: "1px solid var(--border)",
          background: done ? "var(--status-done)" : "transparent",
          color: done ? "#ffffff" : "var(--fg-subtle)",
          fontSize: 10,
          fontWeight: 500,
          transition: "background-color 120ms, color 120ms",
          opacity: 0.7,
        }}
      >
        {done ? (
          <Check size={10} />
        ) : (
          <Copy size={10} />
        )}
        <span>{done ? "Copied" : "AI"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="btn btn-outline"
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? "Copied" : "Copiar para IA"}
    </button>
  );
}