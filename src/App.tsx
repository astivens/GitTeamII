import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { AppHeader } from "./components/layout/AppHeader";
import {
  EmptyState,
  NoProjectEmptyState,
  OnboardingState,
} from "./components/layout/EmptyState";
import { KanbanBoard } from "./components/tickets/KanbanBoard";
import { GraphView } from "./components/graph/GraphView";
import { TicketModal } from "./components/tickets/TicketModal";
import { Button } from "./components/ui/Button";
import { CommandPalette } from "./components/ui/CommandPalette";
import { HelpOverlay } from "./components/ui/HelpOverlay";
import { ToastHost } from "./components/ui/ToastHost";
import { SetupScreen } from "./components/setup/SetupScreen";
import { ConflictBanner } from "./components/conflicts/ConflictBanner";
import { ConflictModal } from "./components/conflicts/ConflictModal";
import { useTicketsStore } from "./store/tickets";
import { useGlobalShortcuts } from "./lib/keyboard";
import { pushToast } from "./lib/toast";
import { gitteamLinkIntake } from "./lib/tauri";
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
  const projects = useTicketsStore((s) => s.projects);
  const activeProject = useTicketsStore((s) => s.activeProject);
  const syncStatus = useTicketsStore((s) => s.syncStatus);
  const loadProjects = useTicketsStore((s) => s.loadProjects);
  const syncError = useTicketsStore((s) => s.syncError);
  const justSetup = useTicketsStore((s) => s.justSetup);
  const viewMode = useTicketsStore((s) => s.viewMode);

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  /**
   * Forces the SetupScreen to render on demand, even when there are already
   * linked projects. The value remembers which project was active when the user
   * asked for the screen ("" when there was none): the screen has to close when
   * a *different* project becomes active — that is a successful submission — and
   * not the moment it opens, which is what made this CTA dead whenever a project
   * was already linked.
   */
  const [setupForcedFrom, setSetupForcedFrom] = useState<string | null>(null);
  /**
   * The invitation that opened the SetupScreen, when the user got there by
   * clicking a `gitteam://` link instead of pasting one. Cleared whenever the
   * screen closes: left behind, the next "Link new repository" would open the
   * join form holding somebody else's old invitation.
   */
  const [inviteFromLink, setInviteFromLink] = useState<string | null>(null);

  useEffect(() => {
    void loadProjects().finally(() => setBootDone(true));
  }, [loadProjects]);

  // Listen for the ProjectSwitcher's "Link new repository" CTA and any other
  // UI surfaces that want to open the SetupScreen on demand. We reset the
  // forced flag once the user has an active project again so a successful
  // SetupScreen submission restores the normal app shell.
  useEffect(() => {
    function onLinkNew() {
      setSetupForcedFrom(activeProject?.id ?? "");
    }
    window.addEventListener("gitteam:link-new-repo", onLinkNew);
    return () => window.removeEventListener("gitteam:link-new-repo", onLinkNew);
  }, [activeProject]);

  useEffect(() => {
    if (
      setupForcedFrom !== null &&
      (activeProject?.id ?? "") !== setupForcedFrom
    ) {
      setSetupForcedFrom(null);
      setInviteFromLink(null);
    }
  }, [activeProject, setupForcedFrom]);

  // An invitation opens the SetupScreen, but only once the boot is over: until
  // then there is no active project to remember, and forcing the screen with
  // "nothing was active" makes the project that loads a moment later close it —
  // which is losing the very invitation that opened the app. Same opener as the
  // "Link new repository" CTA, so a successful join closes the screen.
  useEffect(() => {
    if (!inviteFromLink || !bootDone || setupForcedFrom !== null) return;
    setSetupForcedFrom(activeProject?.id ?? "");
  }, [inviteFromLink, bootDone, activeProject, setupForcedFrom]);

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

  // A `gitteam://` link is the other way into the join flow: the user clicks it
  // in whatever messenger they already use. On Linux and Windows the OS does not
  // hand the URL to the app that is already running — it starts a second
  // instance, which the single-instance plugin turns into an event for this one.
  // `getCurrent` covers the other half: when the link is what launched the app,
  // that event fires before this listener exists.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    async function openReceived(urls: string[] | null) {
      if (!urls || urls.length === 0) return;
      try {
        // Which shape counts as an invitation is decided by the backend, the
        // same place that reads a pasted one.
        const intake = await gitteamLinkIntake(urls);
        if (intake.invite) {
          // Keeping the link is all this does: which project was active when it
          // arrived is decided by the effect below, which waits for the boot to
          // finish. Reading it here would see a project that has not loaded yet.
          setInviteFromLink(intake.invite);
          return;
        }
        if (intake.not_an_invitation) {
          pushToast("That link is not a GitTeam invitation.", "error");
        }
      } catch (e) {
        pushToast(
          `Could not read that link: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }
    }

    void (async () => {
      try {
        const stop = await onOpenUrl((urls) => void openReceived(urls));
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
        await openReceived(await getCurrent());
      } catch {
        // Not running inside Tauri (e.g. plain vite dev) — silently ignore.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Global shortcuts (Cmd+K, n, /, ?).
  useGlobalShortcuts();

  const onNew = () => setModal({ kind: "create" });
  const onSelect = (t: Ticket) => setModal({ kind: "edit", ticket: t });
  const onClose = () => setModal({ kind: "closed" });

  // Re-read the open ticket from the store on every render so changes that
  // round-trip through the backend while the modal is open (linking tickets,
  // an external sync) are reflected immediately instead of showing the stale
  // snapshot taken when the modal was opened.
  const modalTicket = useMemo(() => {
    if (modal.kind !== "edit") return null;
    return (
      tickets.find((t) => t.filename === modal.ticket.filename) ?? modal.ticket
    );
  }, [modal, tickets]);

  // Wire the global "new ticket" shortcut (the `n` key) to the same handler.
  useEffect(() => {
    function onShortcut() {
      onNew();
    }
    window.addEventListener("gitteam:new-ticket", onShortcut);
    return () => window.removeEventListener("gitteam:new-ticket", onShortcut);
  }, []);

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

  const showEmpty = useMemo(
    () => initialized && !loading && tickets.length === 0,
    [initialized, loading, tickets],
  );

  const closeSetup = () => {
    setInviteFromLink(null);
    setSetupForcedFrom(null);
  };

  // First-time setup: full-screen SetupScreen only when the user has never
  // linked a repository. If `projects > 0` but `activeProject === null` (e.g.
  // after the user removes their active project), we render the normal app
  // shell instead — the ProjectSwitcher pill in the header shows an empty
  // state and the main area shows the NoProjectEmptyState card.
  if (
    bootDone &&
    (setupForcedFrom !== null ||
      (syncStatus === "unconfigured" && projects.length === 0))
  ) {
    return (
      <div className="h-full bg-bg text-fg">
        <SetupScreen
          initialInviteLink={inviteFromLink}
          onCancel={
            setupForcedFrom !== null && activeProject ? closeSetup : undefined
          }
        />
        <ToastHost />
        <HelpOverlay />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg text-fg">
      <AppHeader onNewTicket={onNew} />

      {activeProject ? (
        <div className="px-4 py-1.5 text-xs text-fg-subtle font-mono border-b bg-bg">
          {activeProject.id}
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
            <Button variant="primary" onClick={() => void loadProjects()}>
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
              <p
                className="text-fg-subtle text-xs font-mono"
                style={{ maxWidth: 448, whiteSpace: "pre-wrap" }}
              >
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
        ) : !activeProject && syncStatus === "unconfigured" ? (
          // Projects > 0 but none active (e.g. user just removed the active
          // one). Show the no-project card with a CTA that reopens
          // SetupScreen.
          <NoProjectEmptyState
            onLinkRepo={() => setSetupForcedFrom("")}
          />
        ) : showEmpty ? (
          justSetup ? (
            <OnboardingState onCreate={onNew} />
          ) : (
            <EmptyState onCreate={onNew} />
          )
        ) : viewMode === "graph" ? (
          <GraphView
            onOpenTicket={(filename) => {
              const t = tickets.find((x) => x.filename === filename);
              if (t) onSelect(t);
            }}
          />
        ) : (
          <KanbanBoard tickets={tickets} onSelect={onSelect} />
        )}
      </main>

      <TicketModal
        open={modal.kind !== "closed"}
        mode={modal.kind === "create" ? "create" : "edit"}
        ticket={modalTicket}
        onClose={onClose}
        onDelete={
          modal.kind === "edit" ? () => void onDelete(modal.ticket) : null
        }
      />

      <CommandPalette
        onCreateTicket={onNew}
        onEditTicket={(filename) => {
          const t = tickets.find((x) => x.filename === filename);
          if (t) onSelect(t);
        }}
      />

      <ConflictModal
        open={conflictModalOpen}
        onClose={() => setConflictModalOpen(false)}
      />

      <HelpOverlay />

      <ToastHost />
    </div>
  );
}

export default App;
