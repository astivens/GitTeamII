import { useEffect } from "react";
import { useTicketsStore } from "../store/tickets";

/**
 * Returns true when the user is typing in something that should NOT receive
 * global shortcuts (input, textarea, contenteditable, select).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Flash a transient toast-like inline confirmation when Y copies an ID.
 * Uses the same bus as the rest of the UI; tiny so it doesn't depend on
 * importing the toast module here (kept dependency-light).
 */
function flashYankToast(label: string) {
  window.dispatchEvent(new CustomEvent("gitteam:flash", { detail: label }));
}

/**
 * Register the global keyboard shortcuts:
 *   ⌘K          toggle command palette
 *   N (uppercase)  new ticket
 *   /           focus palette search
 *   ?           toggle help overlay
 *   Y (uppercase)  yank current ticket ID to clipboard
 *   G then K    switch to the board view
 *   G then G    switch to the graph view
 *
 * Mount once at the app root.
 *
 * Esc is NOT bound here — individual modals own their own Esc handler because
 * multiple modals can be open at once (e.g. palette on top of TicketModal) and
 * a single global Esc handler would close them in the wrong order.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    // "g" acts as a chord prefix: press g, then k for the board or g for the
    // graph. The chord expires so a stray g never swallows the next keypress.
    let gArmed = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    const disarmG = () => {
      gArmed = false;
      if (gTimer !== null) {
        clearTimeout(gTimer);
        gTimer = null;
      }
    };
    const armG = () => {
      gArmed = true;
      if (gTimer !== null) clearTimeout(gTimer);
      gTimer = setTimeout(disarmG, 1200);
    };

    function onKey(e: KeyboardEvent): void {
      // Shortcuts that require a modifier (Cmd/Ctrl) fire regardless of focus
      // — that's the universal convention for command palettes.
      const mod = e.metaKey || e.ctrlKey;

      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const { paletteOpen, closePalette, openPalette } =
          useTicketsStore.getState();
        if (paletteOpen) closePalette();
        else openPalette();
        return;
      }

      // The remaining shortcuts are un-modified and must NOT trigger while the
      // user is typing into a field.
      if (mod) return;
      if (isEditableTarget(e.target)) return;

      // g-chord: g k -> board, g g -> graph.
      if (gArmed) {
        if (e.key === "k" || e.key === "K") {
          e.preventDefault();
          disarmG();
          useTicketsStore.getState().setViewMode("board");
          return;
        }
        if (e.key === "g" || e.key === "G") {
          e.preventDefault();
          disarmG();
          useTicketsStore.getState().setViewMode("graph");
          return;
        }
        // Any other key cancels the chord but still performs its own action.
        disarmG();
      }

      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        armG();
        return;
      }

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        // Don't open a new modal if anything else is already open — prevents
        // stacking modals from a stray keypress.
        const { paletteOpen, helpOpen } = useTicketsStore.getState();
        if (paletteOpen || helpOpen) return;
        // Trigger the same path the header's "New ticket" button uses by
        // dispatching a custom event the app root listens for. Keeping the
        // shortcut layer free of UI state avoids a tight coupling with App.tsx.
        window.dispatchEvent(new CustomEvent("gitteam:new-ticket"));
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        // Set the prefill BEFORE opening so the palette's open-effect can read
        // it synchronously. Using a store flag avoids the race of an event that
        // might fire before the palette has mounted.
        useTicketsStore.setState({ paletteFocusQuery: "/" });
        useTicketsStore.getState().openPalette();
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        const { helpOpen, openHelp, closeHelp } = useTicketsStore.getState();
        if (helpOpen) closeHelp();
        else openHelp();
        return;
      }

      // Y — yank current ticket ID. We use the LAST VIEWED ticket, tracked in
      // the store. If there is none, the keypress is a no-op (the user hasn't
      // opened any ticket yet).
      if (e.key === "y" || e.key === "Y") {
        const { lastViewedId } = useTicketsStore.getState();
        if (lastViewedId) {
          e.preventDefault();
          navigator.clipboard
            .writeText(lastViewedId)
            .then(() => flashYankToast(`Yanked ${lastViewedId}`))
            .catch(() => {
              // Silent — the in-card Y button still works as a fallback.
            });
        }
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      disarmG();
    };
  }, []);
}