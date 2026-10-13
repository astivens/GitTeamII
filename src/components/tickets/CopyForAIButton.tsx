import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Button } from "../ui/Button";
import { pushToast } from "../../lib/toast";
import { useTicketsStore } from "../../store/tickets";

interface CopyForAIButtonProps {
  filename: string;
}

export function CopyForAIButton({ filename }: CopyForAIButtonProps) {
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

  return (
    <Button variant="outline" onClick={onClick} disabled={busy}>
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? "Copied" : "Copiar para IA"}
    </Button>
  );
}