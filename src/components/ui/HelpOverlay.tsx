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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeHelp();
      }}
    >
      <div className="card w-full max-w-[480px] shadow-elevated">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-fg">Keyboard shortcuts</h2>
          <button
            type="button"
            className="btn-ghost p-1"
            aria-label="Close"
            onClick={closeHelp}
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          <ul className="divide-y divide-border">
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