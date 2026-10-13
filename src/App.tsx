import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { AppHeader } from "./components/layout/AppHeader";
import { EmptyState } from "./components/layout/EmptyState";
import { KanbanBoard } from "./components/tickets/KanbanBoard";
import { TicketModal } from "./components/tickets/TicketModal";
import { Button } from "./components/ui/Button";
import { ToastHost } from "./components/ui/ToastHost";
import { SetupScreen } from "./components/setup/SetupScreen";
import { ConflictBanner } from "./components/conflicts/ConflictBanner";
import { ConflictModal } from "./components/conflicts/ConflictModal";
import { useTicketsStore } from "./store/tickets";
import { pushToast } from "./lib/toast";
import type { Ticket } from "./types/ticket";

interface RemoteChangedPayload {
  sha: string;
  detected_at: string;
}

type ModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; ticket: Ticket };

function App() {
  const initialized = useTicketsStore((s) => s.initialized);
  const loading = useTicketsStore((s) => s.loading);
  const error = useTicketsStore((s) => s.error);
  const tickets = useTicketsStore((s) => s.tickets);
  const remove = useTicketsStore((s) => s.remove);
  const dataDir = useTicketsStore((s) => s.dataDir);
  const syncStatus = useTicketsStore((s) => s.syncStatus);
  const loadConfig = useTicketsStore((s) => s.loadConfig);
  const syncError = useTicketsStore((s) => s.syncError);

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [bootDone, setBootDone] = useState(false);

  useEffect(() => {
    void loadConfig().finally(() => setBootDone(true));
  }, [loadConfig]);

  // Window focus → auto-pull if synced and no pending local changes
  useEffect(() => {
    const onFocus = () => {
      const { syncStatus, pendingCommits, syncNow, flushNow } =
        useTicketsStore.getState();
      if (syncStatus !== "synced") return;
      if (pendingCommits.size > 0) {
        void flushNow();
        return;
      }
      void syncNow();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Tauri event: background ls-remote worker reports remote HEAD changed
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listen<RemoteChangedPayload>(
          "remote-changed",
          (event) => {
            const { syncStatus, pendingCommits, setRemoteSha, syncNow } =
              useTicketsStore.getState();
            setRemoteSha(event.payload.sha);
            if (syncStatus === "synced" && pendingCommits.size === 0) {
              pushToast(
                "Cambios remotos detectados — sincronizando…",
                "default",
              );
              void syncNow();
            }
          },
        );
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      } catch {
        // Not running inside Tauri (e.g. dev) — silently ignore.
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const showEmpty = useMemo(
    () => initialized && !loading && tickets.length === 0,
    [initialized, loading, tickets],
  );

  // First-time setup: full-screen SetupScreen
  if (bootDone && syncStatus === "unconfigured") {
    return (
      <div className="h-full bg-bg text-fg">
        <SetupScreen />
        <ToastHost />
      </div>
    );
  }

  const onNew = () => setModal({ kind: "create" });
  const onSelect = (t: Ticket) => setModal({ kind: "edit", ticket: t });
  const onClose = () => setModal({ kind: "closed" });

  const onDelete = async (t: Ticket) => {
    const ok = window.confirm(`Delete ${t.id}? This cannot be undone.`);
    if (!ok) return;
    try {
      await remove(t.filename);
      pushToast("Ticket deleted", "success");
      onClose();
    } catch (e) {
      pushToast(
        `Error deleting: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
  };

  return (
    <div className="h-full flex flex-col bg-bg text-fg">
      <AppHeader onNewTicket={onNew} />

      {dataDir ? (
        <div className="px-4 py-1.5 text-xs text-fg-subtle font-mono border-b border-border bg-bg">
          {dataDir}
        </div>
      ) : null}

      {syncStatus === "conflict" ? (
        <ConflictBanner onResolve={() => setConflictModalOpen(true)} />
      ) : null}

      <main className="flex-1 min-h-0 overflow-hidden">
        {!bootDone || (loading && !initialized) ? (
          <div className="h-full w-full flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-fg-muted" />
          </div>
        ) : error && !initialized ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3">
            <p className="text-fg-muted">Failed to initialize: {error}</p>
            <Button variant="primary" onClick={() => void loadConfig()}>
              <RefreshCw size={14} />
              Retry
            </Button>
          </div>
        ) : syncStatus === "error" && !initialized ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-fg-muted">
              Could not connect to the repository.
            </p>
            {syncError ? (
              <p className="text-fg-subtle text-xs max-w-md font-mono whitespace-pre-wrap">
                {syncError}
              </p>
            ) : null}
            <Button
              variant="primary"
              onClick={() => {
                useTicketsStore.setState({ syncStatus: "unconfigured" });
              }}
            >
              Set up again
            </Button>
          </div>
        ) : showEmpty ? (
          <EmptyState onCreate={onNew} />
        ) : (
          <KanbanBoard tickets={tickets} onSelect={onSelect} />
        )}
      </main>

      <TicketModal
        open={modal.kind !== "closed"}
        mode={modal.kind === "create" ? "create" : "edit"}
        ticket={modal.kind === "edit" ? modal.ticket : null}
        onClose={onClose}
        onDelete={
          modal.kind === "edit" ? () => void onDelete(modal.ticket) : null
        }
      />

      <ConflictModal
        open={conflictModalOpen}
        onClose={() => setConflictModalOpen(false)}
      />

      <ToastHost />
    </div>
  );
}

export default App;
