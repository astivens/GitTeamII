import { useEffect } from "react";
import { X } from "lucide-react";
import { useTicketsStore } from "../../store/tickets";
import { SHORTCUTS } from "../../lib/shortcuts";

export function HelpOverlay() {
  const open = useTicketsStore((s) => s.helpOpen);
  const closeHelp = useTicketsStore((s) => s.closeHelp);

  // Esc closes — bound here so it's specific to this overlay even if the
  // TicketModal is open underneath.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeHelp();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeHelp]);

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
        zIndex: 50,
        background: "rgba(0, 0, 0, 0.6)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeHelp();
      }}
    >
      <div
        className="card w-full"
        style={{ maxWidth: 480, boxShadow: "var(--shadow-elevated)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-base font-semibold text-fg">Keyboard shortcuts</h2>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: 4 }}
            aria-label="Close"
            onClick={closeHelp}
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          <ul className="divide-border">
            {SHORTCUTS.map((s) => (
              <li
                key={s.action}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="text-sm text-fg-muted">{s.action}</span>
                <span className="flex items-center gap-1">
                  {s.keys.map((k, i) => (
                    <span key={i} className="kbd">
                      {k}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
