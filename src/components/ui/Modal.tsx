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

  return (
    <div
      className="flex items-center justify-center p-4"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: "rgba(0, 0, 0, 0.6)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card w-full flex flex-col overflow-hidden"
        style={{
          maxWidth: wide ? 1100 : 720,
          maxHeight: "85vh",
          boxShadow: "var(--shadow-elevated)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: 4 }}
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
