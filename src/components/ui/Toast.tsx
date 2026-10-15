import type { ToastItem, ToastTone } from "../../lib/toast";

interface ToastViewProps {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}

function toneClasses(tone: ToastTone): string {
  switch (tone) {
    case "success":
      return "toast-success";
    case "error":
      return "toast-error";
    case "default":
    default:
      return "";
  }
}

export function Toast({ toast, onDismiss }: ToastViewProps) {
  return (
    <div
      role="status"
      onClick={() => onDismiss(toast.id)}
      className={`toast cursor-pointer ${toneClasses(toast.tone)}`}
      style={{ minWidth: 220, maxWidth: 360 }}
    >
      {toast.message}
    </div>
  );
}
