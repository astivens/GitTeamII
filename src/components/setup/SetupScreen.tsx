import { useEffect, useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTicketsStore } from "../../store/tickets";
import { pushToast } from "../../lib/toast";
import * as api from "../../lib/tauri";
import type { InviteDetails, PendingInvitation } from "../../types/git";

type Mode = "connect" | "create" | "join";

interface SetupScreenProps {
  /** Present when the screen was opened on demand over an already linked board. */
  onCancel?: () => void;
  /**
   * The invitation that opened this screen, when the user got here by clicking a
   * `gitteam://` link instead of pasting one. The form starts on the join path
   * with the link already in place, and reads it on its own: the click is the
   * choice, so asking for the same link again by hand would be asking twice.
   */
  initialInviteLink?: string | null;
}

/**
 * The first screen when there is no project to work on. It offers the three
 * ways a board comes into existence: connecting a repository that already
 * exists, creating one — a private tickets repository on GitHub — and joining
 * one that somebody invited you to.
 *
 * Sharing a board is sharing its repository, which is why a board has a
 * repository of its own and the one holding the code is never involved.
 */
export function SetupScreen({ onCancel, initialInviteLink }: SetupScreenProps) {
  const addProject = useTicketsStore((s) => s.addProject);
  const createBoard = useTicketsStore((s) => s.createBoard);
  const activeProject = useTicketsStore((s) => s.activeProject);

  const [mode, setMode] = useState<Mode>(
    initialInviteLink ? "join" : "connect",
  );
  const [url, setUrl] = useState("");
  const [boardName, setBoardName] = useState("");
  const [inviteLink, setInviteLink] = useState(initialInviteLink ?? "");
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  // La invitación viaja junto al destino por el que se preguntó: aceptarla tiene
  // que reintentar *ese* destino, y en conectar no hay link parseado del que
  // sacarlo. Sin esto, el botón existía en pantalla y no hacía nada.
  const [pending, setPending] = useState<{
    invitation: PendingInvitation;
    target: string;
  } | null>(null);
  const [pat, setPat] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // With a project already linked, the backend reuses its saved token and git
  // identity, so creating a board can be one click. On first run there is
  // nothing to reuse and the form has to supply them.
  const identityIsInherited = mode === "create" && activeProject !== null;
  const checkingInvite = mode === "join" && invite === null;

  const switchMode = (next: Mode) => {
    setMode(next);
    // A parsed invitation belongs to the join form alone: leaving it behind
    // would let it decide where another form clones from.
    setInvite(null);
    setPending(null);
    setError(null);
  };

  /**
   * Reads a link and leaves it on screen: that is the step that shows which
   * board it is for, before a token is asked for. The pasted one and the one
   * that opened the app go through here.
   */
  async function readInvite(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Paste the invitation link you were sent.");
      return;
    }
    setBusy(true);
    try {
      setInvite(await api.boardParseInvite(trimmed));
      setPending(null);
    } catch (err) {
      setInvite(null);
      setPending(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const checkInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    await readInvite(inviteLink);
  };

  // A link that arrives while this screen is already up changes what there is to
  // do: it moves the form to join and reads it, instead of leaving it waiting to
  // be pasted by hand.
  useEffect(() => {
    if (!initialInviteLink) return;
    setMode("join");
    setInviteLink(initialInviteLink);
    setError(null);
    void readInvite(initialInviteLink);
  }, [initialInviteLink]);

  /**
   * The path a join and a connect share: test the connection, then enter through
   * the same door a hand-made clone uses. When the test fails, GitHub may be
   * holding an invitation for this board, so it asks for it — accepting it from
   * here is what the mail would otherwise be for.
   */
  const joinBoard = async (
    target: string,
    token: string,
    name: string,
    email: string,
  ) => {
    const test = await api.gitTestConnection(target, token);
    if (!test.ok) {
      setError(test.error ?? "Could not connect to the repository.");
      try {
        const [invitation] = await api.githubPendingInvitations(token, target);
        setPending(invitation ? { invitation, target } : null);
      } catch {
        // If GitHub cannot be asked, the clone error stands: nothing is invented.
        setPending(null);
      }
      return;
    }
    setPending(null);
    await addProject({
      url: target,
      pat: token,
      user_name: name,
      user_email: email,
    });
    pushToast(`Connected to ${test.repo_name}`, "success");
  };

  const acceptPending = async () => {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      await api.githubAcceptInvitation(pat.trim(), pending.invitation.id);
      const target = pending.target;
      setPending(null);
      pushToast("Invitation accepted", "success");
      await joinBoard(
        target,
        pat.trim(),
        userName.trim(),
        userEmail.trim(),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
    } else if (mode === "create") {
      if (
        !identityIsInherited &&
        (!trimmedPat || !trimmedName || !trimmedEmail)
      ) {
        setError(
          "A token, a git user name and a git user email are required to create the first board.",
        );
        return;
      }
    } else if (!trimmedPat || !trimmedName || !trimmedEmail) {
      // Joining is the one path where nothing can be inherited: the credential
      // is the joiner's own, and there is no board here to take an identity from.
      setError(
        "Your own token, name and email are required: a private board clones with your credentials.",
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
        await joinBoard(
          invite ? invite.repo_url : trimmedUrl,
          trimmedPat,
          trimmedName,
          trimmedEmail,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

      <div className="w-full flex flex-col gap-3" style={{ maxWidth: 480 }}>
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
          <Button
            type="button"
            variant={mode === "join" ? "primary" : "outline"}
            className="flex-1"
            onClick={() => switchMode("join")}
          >
            Join a board
          </Button>
        </div>

        <form
          onSubmit={checkingInvite ? checkInvite : submit}
          className="card p-6 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-fg font-medium">
              {mode === "connect"
                ? "Connect your team's repository"
                : mode === "create"
                  ? "Create a board"
                  : "Join a board"}
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
              ) : mode === "create" ? (
                <>
                  GitTeam creates a private repository on GitHub that holds only
                  tickets. Sharing a board is sharing that repository, so the
                  repository holding your code is never involved.
                </>
              ) : (
                <>
                  Paste the invitation you were sent. GitTeam shows you which
                  board it is for before it clones anything.
                </>
              )}
            </p>
          </div>

          {mode === "connect" ? (
            <Input
              label="Repository URL"
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.currentTarget.value);
                // La invitación que se ofrecía era para otra dirección: si el
                // usuario la cambia, la oferta ya no es sobre lo que está en
                // pantalla.
                setPending(null);
              }}
              placeholder="https://github.com/owner/repo.git"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          ) : null}

          {mode === "create" ? (
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
          ) : null}

          {mode === "join" ? (
            <>
              <Input
                label="Invitation link"
                type="text"
                value={inviteLink}
                onChange={(e) => {
                  setInviteLink(e.currentTarget.value);
                  setInvite(null);
                  setPending(null);
                }}
                placeholder="gitteam://join?repo=…"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />

              {invite ? (
                <div
                  className="card flex flex-col gap-1"
                  style={{ padding: 12 }}
                >
                  <p className="text-fg text-sm">
                    {invite.board ? (
                      <>
                        Board{" "}
                        <span className="font-mono">{invite.board}</span>
                      </>
                    ) : (
                      "A board"
                    )}
                    {invite.from ? <> · invited by {invite.from}</> : null}
                  </p>
                  <p
                    className="text-fg-subtle text-xs font-mono"
                    style={{ wordBreak: "break-all" }}
                  >
                    {invite.repo_url}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {checkingInvite ? null : (
            <>
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
                  ) : mode === "join" ? (
                    <>
                      The board is private, so it clones with your own access to
                      GitHub — the same token you would use to clone it by hand.
                    </>
                  ) : (
                    <>
                      GitHub → Settings → Developer settings → Personal access
                      tokens (classic, with{" "}
                      <code className="font-mono">repo</code> scope)
                    </>
                  )}
                </p>
              </div>

              <div
                className="gap-3"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                }}
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
                  Leave the name and email empty to reuse the ones already saved
                  for this project.
                </p>
              ) : null}

              {mode === "join" ? (
                <p className="text-fg-subtle text-xs">
                  Your access has to be granted by whoever invited you: the link
                  is not a key, and the board is private. If they already gave it
                  to you by user name, GitTeam offers to accept the invitation
                  here.
                </p>
              ) : null}
            </>
          )}

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

          {pending ? (
            <div
              className="text-sm border rounded-md px-3 py-2 flex flex-col"
              style={{
                gap: 8,
                borderColor: "rgba(99, 102, 241, 0.4)",
                background: "rgba(99, 102, 241, 0.1)",
              }}
            >
              <p className="text-fg">
                GitHub is holding an invitation for you on{" "}
                <span className="font-mono">{pending.invitation.repo}</span>
                {pending.invitation.from ? (
                  <> · sent by {pending.invitation.from}</>
                ) : null}
                . A private board clones once it is accepted.
              </p>
              <Button
                type="button"
                variant="primary"
                onClick={() => void acceptPending()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                Accept and join
              </Button>
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
                {mode === "create"
                  ? "Creating…"
                  : checkingInvite
                    ? "Checking…"
                    : "Testing & connecting…"}
              </>
            ) : mode === "create" ? (
              "Create board"
            ) : mode === "join" ? (
              checkingInvite ? (
                "Check link"
              ) : (
                "Join this board"
              )
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
