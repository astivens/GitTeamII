import type { ToastItem, ToastTone } from "../../lib/toast";

interface ToastViewProps {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}

function toneClasses(tone: ToastTone): string {
  switch (tone) {
    case "success":
      return "border-priority-low/50";
    case "error":
      return "border-priority-urgent/60";
    case "default":
    default:
      return "border-border";
  }
}

export function Toast({ toast, onDismiss }: ToastViewProps) {
  return (
    <div
      role="status"
      onClick={() => onDismiss(toast.id)}
      className={`card animate-[slideIn_180ms_ease-out] cursor-pointer shadow-elevated border ${toneClasses(
        toast.tone,
      )} px-3 py-2 min-w-[220px] max-w-[360px] text-sm text-fg`}
    >
      {toast.message}
    </div>
  );
}