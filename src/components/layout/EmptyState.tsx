import { Inbox, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";

interface EmptyStateProps {
  onCreate: () => void;
}

const ONBOARDING_STEPS: Array<{ num: string; label: string; hint?: string }> = [
  { num: "1", label: "Create your first ticket", hint: "press n" },
  { num: "2", label: "The ticket saves to disk + syncs to Git" },
  { num: "3", label: "Press Cmd+K to search, navigate, sync", hint: "⌘K" },
];

export function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full bg-bg-subtle p-4 border border-border">
        <Inbox size={32} className="text-fg-muted" />
      </div>
      <div className="space-y-1">
        <p className="text-fg font-medium">No tickets yet</p>
        <p className="text-fg-muted text-sm">
          Create your first ticket to start working.
        </p>
      </div>
      <Button variant="primary" onClick={onCreate}>
        Create your first ticket
      </Button>
    </div>
  );
}

export function OnboardingState({ onCreate }: EmptyStateProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-6 text-center px-6 max-w-lg mx-auto">
      <div className="rounded-full bg-accent/15 p-4 border border-accent/30">
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
            className="flex items-start gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
          >
            <span className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full bg-accent/20 text-accent text-xs font-mono font-medium">
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
        Create your first ticket
      </Button>
    </div>
  );
}