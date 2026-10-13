import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider layout for modals that need a side-by-side preview. */
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, footer, wide }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = wide ? "max-w-[1100px]" : "max-w-[720px]";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`card w-full ${widthClass} max-h-[85vh] flex flex-col overflow-hidden shadow-elevated`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button
            type="button"
            className="btn-ghost p-1"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}