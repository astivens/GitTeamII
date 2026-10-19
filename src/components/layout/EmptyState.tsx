import { Inbox, Sparkles, FolderGit2, SearchX, PlugZap } from "lucide-react";
import { Button } from "../ui/Button";
import { useI18n } from "../../lib/i18n";

interface EmptyStateProps {
  onCreate: () => void;
}

/**
 * Board is empty (post-onboarding).
 * Voice: short and direct. Real CTA. Specific key.
 */
export function EmptyState({ onCreate }: EmptyStateProps) {
  const { t } = useI18n();
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
          {t.layout.boardIsEmpty}
        </p>
        <p className="text-fg-muted text-sm">
          {t.layout.dropTicket} <span className="kbd">N</span>{" "}
          {t.layout.dropTicketClick}
        </p>
      </div>
      <Button variant="primary" onClick={onCreate}>
        {t.layout.newTicket}
      </Button>
    </div>
  );
}

/**
 * First-time onboarding. Three quick steps.
 */
export function OnboardingState({ onCreate }: EmptyStateProps) {
  const { t } = useI18n();
  // Steps are built from the dictionary so their copy follows the language;
  // the `⌘K` glyph is a key, not a word.
  const steps = [
    {
      num: "1",
      label: t.layout.onboardingStep1,
      hint: t.layout.onboardingStep1Hint,
    },
    { num: "2", label: t.layout.onboardingStep2, hint: null },
    { num: "3", label: t.layout.onboardingStep3, hint: "⌘K" },
  ];
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
        <h2 className="text-fg text-lg font-semibold">{t.layout.onboardingTitle}</h2>
        <p className="text-fg-muted text-sm">
          {t.layout.onboardingSubtitle}
        </p>
      </div>
      <ol className="text-left w-full space-y-2">
        {steps.map((step) => (
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
        {t.layout.newTicket}
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
  const { t } = useI18n();
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
          {t.layout.whichRepo}
        </p>
        <p className="text-fg-muted text-sm">
          {t.layout.linkRepoHint}
        </p>
      </div>
      <Button variant="primary" onClick={onLinkRepo}>
        {t.layout.linkRepository}
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
  const { t } = useI18n();
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full p-4 border bg-bg-subtle">
        <SearchX size={28} className="text-fg-muted" />
      </div>
      <div className="space-y-1">
        <p className="font-mono text-sm text-accent">
          ~ {query || t.layout.emptyQuery}
        </p>
        <p className="font-mono text-base font-bold text-fg">
          {t.layout.noMatches(query)}
        </p>
        <p className="text-fg-muted text-sm">
          {t.layout.noResultsHint}
        </p>
      </div>
      {onCreate ? (
        <Button variant="outline" onClick={onCreate}>
          {t.layout.createNew}
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
  const { t } = useI18n();
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
        <p className="font-mono text-lg font-bold text-fg">{t.layout.repoLinkBroke}</p>
        <p className="text-fg-muted text-sm" style={{ maxWidth: 420 }}>
          {t.layout.repoLinkBrokeHint}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={onReconnect}>
          <PlugZap size={14} />
          {t.layout.reconnect}
        </Button>
        <Button variant="outline" onClick={onDisconnect}>
          {t.layout.disconnect}
        </Button>
      </div>
      <p className="font-mono text-xs text-fg-subtle mt-2">
        {t.layout.localFirstPromise}
      </p>
    </div>
  );
}