import { useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTicketsStore } from "../../store/tickets";
import { pushToast } from "../../lib/toast";
import * as api from "../../lib/tauri";

type Mode = "connect" | "create";

interface SetupScreenProps {
  /** Present when the screen was opened on demand over an already linked board. */
  onCancel?: () => void;
}

/**
 * The first screen when there is no project to work on. It offers the two ways
 * a board comes into existence: connecting a repository that already exists,
 * and creating one — a private tickets repository on GitHub. Sharing a board is
 * sharing that repository, which is why a board has its own repository and the
 * one holding the code is never involved.
 */
export function SetupScreen({ onCancel }: SetupScreenProps) {
  const addProject = useTicketsStore((s) => s.addProject);
  const createBoard = useTicketsStore((s) => s.createBoard);
  const activeProject = useTicketsStore((s) => s.activeProject);

  const [mode, setMode] = useState<Mode>("connect");
  const [url, setUrl] = useState("");
  const [boardName, setBoardName] = useState("");
  const [pat, setPat] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // With a project already linked, the backend reuses its saved token and git
  // identity, so creating a board can be one click. On first run there is
  // nothing to reuse and the form has to supply them.
  const identityIsInherited = mode === "create" && activeProject !== null;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUrl = url.trim();
    const trimmedPat = pat.trim();
    const trimmedName = userName.trim();
    const trimmedEmail = userEmail.trim();

    if (mode === "connect") {
      if (!trimmedUrl || !trimmedPat || !trimmedName || !trimmedEmail) {
        setError("All fields are required.");
        return;
      }
    } else if (
      !identityIsInherited &&
      (!trimmedPat || !trimmedName || !trimmedEmail)
    ) {
      setError(
        "A token, a git user name and a git user email are required to create the first board.",
      );
      return;
    }

    setBusy(true);
    try {
      if (mode === "create") {
        const project = await createBoard({
          name: boardName.trim(),
          pat: trimmedPat,
          user_name: trimmedName,
          user_email: trimmedEmail,
        });
        pushToast(`Created ${project.name}`, "success");
      } else {
        const test = await api.gitTestConnection(trimmedUrl, trimmedPat);
        if (!test.ok) {
          setError(test.error ?? "Could not connect to the repository.");
          return;
        }
        await addProject({
          url: trimmedUrl,
          pat: trimmedPat,
          user_name: trimmedName,
          user_email: trimmedEmail,
        });
        pushToast(`Connected to ${test.repo_name}`, "success");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-bg px-4 py-8 overflow-y-auto">
      <div className="flex flex-col items-center gap-2 mb-8">
        <div className="rounded-full bg-bg-subtle border p-3">
          <GitBranch size={24} className="text-accent" />
        </div>
        <h1
          className="font-mono text-xl font-semibold text-fg"
          style={{ letterSpacing: "-0.025em" }}
        >
          GitTeam
        </h1>
      </div>

      <div
        className="w-full flex flex-col gap-3"
        style={{ maxWidth: 480 }}
      >
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === "connect" ? "primary" : "outline"}
            className="flex-1"
            onClick={() => switchMode("connect")}
          >
            Connect a repository
          </Button>
          <Button
            type="button"
            variant={mode === "create" ? "primary" : "outline"}
            className="flex-1"
            onClick={() => switchMode("create")}
          >
            Create a board
          </Button>
        </div>

        <form
          onSubmit={submit}
          className="card p-6 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-fg font-medium">
              {mode === "connect"
                ? "Connect your team's repository"
                : "Create a board"}
            </h2>
            <p className="text-fg-muted text-sm">
              {mode === "connect" ? (
                <>
                  GitTeam keeps a local copy under{" "}
                  <code className="font-mono text-fg-subtle">
                    ~/.gitteam/projects/
                  </code>{" "}
                  and keeps it in sync.
                </>
              ) : (
                <>
                  GitTeam creates a private repository on GitHub that holds only
                  tickets. Sharing a board is sharing that repository, so the
                  repository holding your code is never involved.
                </>
              )}
            </p>
          </div>

          {mode === "connect" ? (
            <Input
              label="Repository URL"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              placeholder="https://github.com/owner/repo.git"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          ) : (
            <Input
              label="Board name"
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.currentTarget.value)}
              placeholder={
                activeProject ? `${activeProject.name}-board` : "my-team-board"
              }
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          )}

          <div className="flex flex-col gap-1">
            <Input
              label={
                identityIsInherited
                  ? "Personal access token (optional)"
                  : "Personal access token"
              }
              type="password"
              value={pat}
              onChange={(e) => setPat(e.currentTarget.value)}
              placeholder="ghp_…"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-fg-subtle text-xs">
              {identityIsInherited ? (
                "Leave it empty to reuse the token already saved for this project."
              ) : (
                <>
                  GitHub → Settings → Developer settings → Personal access
                  tokens (classic, with <code className="font-mono">repo</code>{" "}
                  scope)
                </>
              )}
            </p>
          </div>

          <div
            className="gap-3"
            style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)" }}
          >
            <Input
              label="Git user name"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.currentTarget.value)}
              placeholder="Carlos Dev"
              autoComplete="off"
            />
            <Input
              label="Git user email"
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.currentTarget.value)}
              placeholder="carlos@example.com"
              autoComplete="off"
            />
          </div>

          {identityIsInherited ? (
            <p className="text-fg-subtle text-xs">
              Leave the name and email empty to reuse the ones already saved for
              this project.
            </p>
          ) : null}

          {error ? (
            <div
              className="text-sm border rounded-md px-3 py-2"
              style={{
                color: "var(--priority-urgent)",
                borderColor: "rgba(239, 68, 68, 0.4)",
                background: "rgba(239, 68, 68, 0.1)",
              }}
            >
              {error}
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            className="w-full"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {mode === "create" ? "Creating…" : "Testing & connecting…"}
              </>
            ) : mode === "create" ? (
              "Create board"
            ) : (
              "Test & Connect"
            )}
          </Button>
        </form>

        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onCancel}
          >
            Back to my board
          </Button>
        ) : null}
      </div>
    </div>
  );
}
