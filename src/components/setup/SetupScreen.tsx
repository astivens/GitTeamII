import { useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTicketsStore } from "../../store/tickets";
import { pushToast } from "../../lib/toast";
import * as api from "../../lib/tauri";

export function SetupScreen() {
  const setupRepo = useTicketsStore((s) => s.setupRepo);

  const [url, setUrl] = useState("");
  const [pat, setPat] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUrl = url.trim();
    const trimmedPat = pat.trim();
    const trimmedName = userName.trim();
    const trimmedEmail = userEmail.trim();

    if (!trimmedUrl || !trimmedPat || !trimmedName || !trimmedEmail) {
      setError("All fields are required.");
      return;
    }

    setTesting(true);
    try {
      const test = await api.gitTestConnection(trimmedUrl, trimmedPat);
      if (!test.ok) {
        setError(test.error ?? "Could not connect to the repository.");
        setTesting(false);
        return;
      }
      await setupRepo({
        url: trimmedUrl,
        pat: trimmedPat,
        userName: trimmedName,
        userEmail: trimmedEmail,
      });
      pushToast(`Connected to ${test.repo_name}`, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setTesting(false);
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

      <form
        onSubmit={submit}
        className="w-full card p-6 flex flex-col gap-4"
        style={{ maxWidth: 480 }}
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-fg font-medium">Connect your team's repository</h2>
          <p className="text-fg-muted text-sm">
            GitTeam will clone it to{" "}
            <code className="font-mono text-fg-subtle">~/.gitteam-data</code>{" "}
            and keep it in sync.
          </p>
        </div>

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

        <div className="flex flex-col gap-1">
          <Input
            label="Personal access token"
            type="password"
            value={pat}
            onChange={(e) => setPat(e.currentTarget.value)}
            placeholder="ghp_…"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-fg-subtle text-xs">
            GitHub → Settings → Developer settings → Personal access tokens
            (classic, with <code className="font-mono">repo</code> scope)
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
          disabled={testing}
          className="w-full"
        >
          {testing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Testing & connecting…
            </>
          ) : (
            "Test & Connect"
          )}
        </Button>
      </form>
    </div>
  );
}
