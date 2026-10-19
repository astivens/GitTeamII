import { AlertTriangle, Wrench, XCircle } from "lucide-react";
import { Button } from "../ui/Button";
import { useTicketsStore } from "../../store/tickets";
import { useI18n } from "../../lib/i18n";

interface ConflictBannerProps {
  onResolve: () => void;
}

export function ConflictBanner({ onResolve }: ConflictBannerProps) {
  const { t } = useI18n();
  const conflicts = useTicketsStore((s) => s.conflicts);
  const abortResolution = useTicketsStore((s) => s.abortResolution);

  const count = conflicts.length;
  const label = t.misc.conflicts.bannerLabel(count);

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 px-4 py-2 border-b"
      style={{
        borderColor: "rgba(249, 115, 22, 0.3)",
        background: "rgba(249, 115, 22, 0.1)",
        color: "var(--priority-high)",
      }}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle size={16} />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={onResolve}
          aria-label={t.misc.conflicts.bannerResolveAria}
        >
          <Wrench size={14} />
          {t.misc.conflicts.bannerResolve}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void abortResolution()}
          aria-label={t.misc.conflicts.abortRebase}
          title="git rebase --abort"
        >
          <XCircle size={14} />
          {t.misc.conflicts.abort}
        </Button>
      </div>
    </div>
  );
}
