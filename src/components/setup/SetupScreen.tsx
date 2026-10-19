import { useEffect, useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTicketsStore } from "../../store/tickets";
import { useI18n } from "../../lib/i18n";
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
  const { t } = useI18n();
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
      setError(t.setup.errors.invitationRequired);
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
      setError(test.error ?? t.setup.errors.connectFailed);
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
    pushToast(t.setup.toasts.connected(test.repo_name), "success");
  };

  const acceptPending = async () => {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      await api.githubAcceptInvitation(pat.trim(), pending.invitation.id);
      const target = pending.target;
      setPending(null);
      pushToast(t.setup.toasts.invitationAccepted, "success");
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
        setError(t.setup.errors.allFieldsRequired);
        return;
      }
    } else if (mode === "create") {
      if (
        !identityIsInherited &&
        (!trimmedPat || !trimmedName || !trimmedEmail)
      ) {
        setError(t.setup.errors.createCredentialsRequired);
        return;
      }
    } else if (!trimmedPat || !trimmedName || !trimmedEmail) {
      // Joining is the one path where nothing can be inherited: the credential
      // is the joiner's own, and there is no board here to take an identity from.
      setError(t.setup.errors.joinCredentialsRequired);
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
        pushToast(t.setup.toasts.created(project.name), "success");
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
            {t.setup.modes.connect.button}
          </Button>
          <Button
            type="button"
            variant={mode === "create" ? "primary" : "outline"}
            className="flex-1"
            onClick={() => switchMode("create")}
          >
            {t.setup.modes.create.button}
          </Button>
          <Button
            type="button"
            variant={mode === "join" ? "primary" : "outline"}
            className="flex-1"
            onClick={() => switchMode("join")}
          >
            {t.setup.modes.join.button}
          </Button>
        </div>

        <form
          onSubmit={checkingInvite ? checkInvite : submit}
          className="card p-6 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-fg font-medium">
              {t.setup.modes[mode].heading}
            </h2>
            <p className="text-fg-muted text-sm">
              {mode === "connect" ? (
                <>
                  {t.setup.modes.connect.descriptionBefore}{" "}
                  <code className="font-mono text-fg-subtle">
                    ~/.gitteam/projects/
                  </code>{" "}
                  {t.setup.modes.connect.descriptionAfter}
                </>
              ) : mode === "create" ? (
                t.setup.modes.create.description
              ) : (
                t.setup.modes.join.description
              )}
            </p>
          </div>

          {mode === "connect" ? (
            <Input
              label={t.setup.modes.connect.repositoryLabel}
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
              label={t.setup.modes.create.boardNameLabel}
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.currentTarget.value)}
              placeholder={
                activeProject
                  ? t.setup.modes.create.suggestedBoardName(activeProject.name)
                  : t.setup.modes.create.boardNamePlaceholder
              }
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          ) : null}

          {mode === "join" ? (
            <>
              <Input
                label={t.setup.modes.join.invitationLabel}
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
                        {t.setup.invite.board}{" "}
                        <span className="font-mono">{invite.board}</span>
                      </>
                    ) : (
                      t.setup.invite.unnamedBoard
                    )}
                    {invite.from ? t.setup.invite.invitedBy(invite.from) : null}
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
                      ? t.setup.token.optionalLabel
                      : t.setup.token.label
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
                    t.setup.token.inheritedHint
                  ) : mode === "join" ? (
                    t.setup.token.joinHint
                  ) : (
                    <>
                      {t.setup.token.scopeHintBefore}{" "}
                      <code className="font-mono">repo</code>{" "}
                      {t.setup.token.scopeHintAfter}
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
                  label={t.setup.identity.nameLabel}
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.currentTarget.value)}
                  placeholder={t.setup.identity.namePlaceholder}
                  autoComplete="off"
                />
                <Input
                  label={t.setup.identity.emailLabel}
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.currentTarget.value)}
                  placeholder={t.setup.identity.emailPlaceholder}
                  autoComplete="off"
                />
              </div>

              {identityIsInherited ? (
                <p className="text-fg-subtle text-xs">
                  {t.setup.identity.inheritedHint}
                </p>
              ) : null}

              {mode === "join" ? (
                <p className="text-fg-subtle text-xs">
                  {t.setup.modes.join.accessHint}
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
                {t.setup.pending.holding}{" "}
                <span className="font-mono">{pending.invitation.repo}</span>
                {pending.invitation.from
                  ? t.setup.pending.sentBy(pending.invitation.from)
                  : null}
                {t.setup.pending.after}
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
                {t.setup.pending.accept}
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
                  ? t.setup.actions.busyCreate
                  : checkingInvite
                    ? t.setup.actions.busyChecking
                    : t.setup.actions.busyConnect}
              </>
            ) : mode === "create" ? (
              t.setup.actions.submitCreate
            ) : mode === "join" ? (
              checkingInvite ? (
                t.setup.actions.submitCheckLink
              ) : (
                t.setup.actions.submitJoin
              )
            ) : (
              t.setup.actions.submitConnect
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
            {t.setup.actions.back}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
