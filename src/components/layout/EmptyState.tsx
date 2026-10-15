import { Inbox, Sparkles, FolderGit2, SearchX, PlugZap } from "lucide-react";
import { Button } from "../ui/Button";

interface EmptyStateProps {
  onCreate: () => void;
}

const ONBOARDING_STEPS: Array<{ num: string; label: string; hint?: string }> = [
  { num: "1", label: "Create your first ticket", hint: "press n" },
  { num: "2", label: "The ticket saves to disk + syncs to Git" },
  { num: "3", label: "Press Cmd+K to search, navigate, sync", hint: "⌘K" },
];

/**
 * Board is empty (post-onboarding).
 * Voice: short and direct. Real CTA. Specific key.
 */
export function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center gap-4 text-center"
    >
      <div
        className="rounded-full p-4 border bg-bg-subtle"
      >
        <Inbox size={28} className="text-fg-muted" />
      </div>
      <div className="space-y-1">
        <p
          className="font-mono text-lg font-bold text-fg"
        >
          Board is empty.
        </p>
        <p className="text-fg-muted text-sm">
          Drop a ticket. <span className="kbd">N</span> or click anywhere.
        </p>
      </div>
      <Button variant="primary" onClick={onCreate}>
        New ticket
      </Button>
    </div>
  );
}

/**
 * First-time onboarding. Three quick steps.
 */
export function OnboardingState({ onCreate }: EmptyStateProps) {
  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center gap-6 text-center"
      style={{ paddingLeft: 24, paddingRight: 24, maxWidth: 512, margin: "0 auto" }}
    >
      <div
        className="rounded-full p-4 border"
        style={{
          background: "var(--accent-soft)",
          borderColor: "var(--accent)",
        }}
      >
        <Sparkles size={28} className="text-accent" />
      </div>
      <div className="space-y-1">
        <h2 className="text-fg text-lg font-semibold">Welcome to GitTeam</h2>
        <p className="text-fg-muted text-sm">
          Your repository is connected and ready. Three quick steps:
        </p>
      </div>
      <ol className="text-left w-full space-y-2">
        {ONBOARDING_STEPS.map((step) => (
          <li
            key={step.num}
            className="flex items-start gap-3 rounded-md border bg-bg-subtle px-3 py-2.5"
          >
            <span
              className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full font-mono text-xs font-medium text-accent"
              style={{ background: "var(--accent-soft)" }}
            >
              {step.num}
            </span>
            <div className="flex items-center gap-2 text-sm text-fg">
              <span>{step.label}</span>
              {step.hint ? <span className="kbd">{step.hint}</span> : null}
            </div>
          </li>
        ))}
      </ol>
      <Button variant="primary" onClick={onCreate}>
        New ticket
      </Button>
    </div>
  );
}

interface NoProjectProps {
  onLinkRepo: () => void;
}

/**
 * No project linked. Voice: question as heading — invites, not instructs.
 */
export function NoProjectEmptyState({ onLinkRepo }: NoProjectProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-center">
      <div
        className="flex items-center justify-center rounded-lg"
        style={{
          width: 48,
          height: 48,
          background: "var(--accent)",
          color: "#ffffff",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 20,
          borderRadius: 8,
        }}
        aria-hidden="true"
      >
        gt
      </div>
      <div className="space-y-1">
        <p className="font-mono text-lg font-bold text-fg">
          Which repo today?
        </p>
        <p className="text-fg-muted text-sm">
          Link one to start tracking tickets in it.
        </p>
      </div>
      <Button variant="primary" onClick={onLinkRepo}>
        Link repository
        <span className="kbd" style={{ marginLeft: 6 }}>⌘N</span>
      </Button>
    </div>
  );
}

interface NoResultsProps {
  query: string;
  onCreate?: () => void;
}

/**
 * No search results. Voice: echoes the query. Suggests how to broaden.
 */
export function NoResultsEmptyState({ query, onCreate }: NoResultsProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full p-4 border bg-bg-subtle">
        <SearchX size={28} className="text-fg-muted" />
      </div>
      <div className="space-y-1">
        <p className="font-mono text-sm text-accent">~ {query || "empty"}</p>
        <p className="font-mono text-base font-bold text-fg">
          No matches for {query}
        </p>
        <p className="text-fg-muted text-sm">
          Try fuzzy: shorter or longer fragments, tags, or numbers.
        </p>
      </div>
      {onCreate ? (
        <Button variant="outline" onClick={onCreate}>
          Create new
        </Button>
      ) : null}
    </div>
  );
}

interface DisconnectedProps {
  onReconnect: () => void;
  onDisconnect: () => void;
}

/**
 * Connection lost. Local-first promise: your work is never lost.
 */
export function DisconnectedEmptyState({
  onReconnect,
  onDisconnect,
}: DisconnectedProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-center">
      <div
        className="rounded-md flex items-center justify-center"
        style={{
          width: 48,
          height: 32,
          border: "1.5px solid var(--priority-urgent)",
          color: "var(--priority-urgent)",
          position: "relative",
        }}
        aria-hidden="true"
      >
        <FolderGit2 size={20} />
        <span
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "var(--priority-urgent)",
            opacity: 0.15,
            borderRadius: 6,
          }}
        />
        <span
          style={{
            position: "absolute",
            top: "50%",
            left: 4,
            right: 4,
            height: 2,
            background: "var(--priority-urgent)",
            transform: "rotate(-12deg)",
          }}
        />
      </div>
      <div className="space-y-1">
        <p className="font-mono text-lg font-bold text-fg">Repo link broke</p>
        <p className="text-fg-muted text-sm" style={{ maxWidth: 420 }}>
          PAT expired or remote moved. Sync paused, your edits are safe locally.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={onReconnect}>
          <PlugZap size={14} />
          Reconnect
        </Button>
        <Button variant="outline" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
      <p className="font-mono text-xs text-fg-subtle mt-2">
        Local-first promise: your work is never lost.
      </p>
    </div>
  );
}