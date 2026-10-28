import type { Page } from "@playwright/test";
import type { Project } from "../../src/types/git";
import type { Ticket } from "../../src/types/ticket";

/**
 * The scene the fake backend starts from.
 *
 * Only what a spec needs to state: the projects the app can see, which one is
 * active, and the tickets on its board. Everything else has a sane default.
 */
export interface FakeScene {
  projects: Project[];
  activeProjectId: string | null;
  tickets: Ticket[];
  /** Answers the next `git_pull` calls in order; the last one repeats. */
  pulls: Array<{ commits_pulled: number } | { error: string }>;
  conflicts: string[];
  remoteSha: string | null;
}

export const EMPTY_SCENE: FakeScene = {
  projects: [],
  activeProjectId: null,
  tickets: [],
  pulls: [],
  conflicts: [],
  remoteSha: null,
};

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "demo-board",
    name: "Demo board",
    repo_url: "https://github.com/acme/demo-board",
    last_sync_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  const id = overrides.id ?? "TKT-1001";
  const filename = overrides.filename ?? `${id}.md`;
  return {
    id,
    uid: `uid-${id}`,
    title: "Write the E2E harness",
    status: "backlog",
    assignee: null,
    priority: "medium",
    tags: [],
    links: [],
    last_updated: "2026-10-01T10:00:00Z",
    body: "Body",
    filename,
    filepath: `/fake/${filename}`,
    ...overrides,
  };
}

/**
 * Installs a fake `window.__TAURI_INTERNALS__` before the app loads.
 *
 * Every command the UI calls is answered over in-memory state, so the real
 * React app runs unmodified in a plain browser. Anything this fake does not
 * implement is recorded in `__GITTEAM_TEST__.unknownCommands` instead of failing
 * silently: a spec asserts that list stays empty, which is what keeps the fake
 * honest as the app grows.
 */
export async function installTauriMock(
  page: Page,
  scene: Partial<FakeScene> = {},
): Promise<void> {
  await page.addInitScript(fakeBackend, { ...EMPTY_SCENE, ...scene });
}

/** Runs in the page, before any application script. Must stay self-contained. */
function fakeBackend(scene: FakeScene) {
  const state = JSON.parse(JSON.stringify(scene)) as FakeScene & {
    tickets: Ticket[];
    pulls: Array<{ commits_pulled: number } | { error: string }>;
    conflicts: string[];
  };
  const dirty = new Set<string>();
  const clipboard: string[] = [];
  const unknownCommands: string[] = [];
  const callbacks = new Map<number, (payload?: unknown) => void>();
  let nextCallbackId = 1;
  let nextTicketNumber =
    state.tickets.reduce((max, t) => {
      const n = Number.parseInt(t.id.replace(/^TKT-/, ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 1000) + 1;

  const now = () => new Date().toISOString();

  function nextPull(): { commits_pulled: number } | { error: string } {
    const answer = state.pulls.length > 1 ? state.pulls.shift() : state.pulls[0];
    return answer ?? { commits_pulled: 0 };
  }

  function graph() {
    const nodes = state.tickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      tags: t.tags,
      filename: t.filename,
    }));
    const pairs = new Set<string>();
    const edges: Array<{ source: string; target: string }> = [];
    for (const ticket of state.tickets) {
      for (const link of ticket.links) {
        const key = [ticket.id, link].sort().join("|");
        if (pairs.has(key)) continue;
        pairs.add(key);
        edges.push({ source: ticket.id, target: link });
      }
    }
    return { nodes, edges };
  }

  function applyUpdate(filename: string, input: Record<string, unknown>): Ticket {
    const ticket = state.tickets.find((t) => t.filename === filename);
    if (!ticket) throw `ticket not found: ${filename}`;
    Object.assign(ticket, input, {
      id: ticket.id,
      filename: ticket.filename,
      last_updated: now(),
    });
    dirty.add(filename);
    return ticket;
  }

  async function handle(cmd: string, args: Record<string, any>): Promise<unknown> {
    switch (cmd) {
      case "list_projects":
        return [...state.projects];
      case "get_active_project":
        return (
          state.projects.find((p) => p.id === state.activeProjectId) ?? null
        );
      case "switch_project": {
        state.activeProjectId = args.projectId;
        const project = state.projects.find((p) => p.id === args.projectId);
        if (!project) throw `project not found: ${args.projectId}`;
        return project;
      }
      case "remove_project":
        state.projects = state.projects.filter((p) => p.id !== args.projectId);
        if (state.activeProjectId === args.projectId) state.activeProjectId = null;
        return null;
      case "list_tickets":
        return state.tickets.map((t) => ({ ...t }));
      case "read_ticket_raw": {
        const ticket = state.tickets.find((t) => t.filename === args.filename);
        return ticket ? `---\nid: ${ticket.id}\n---\n\n${ticket.body}\n` : "";
      }
      case "create_ticket": {
        const input = args.input ?? {};
        const id = `TKT-${nextTicketNumber++}`;
        const filename = `${id}.md`;
        const ticket: Ticket = {
          id,
          uid: `uid-${id}`,
          title: input.title ?? "",
          status: input.status ?? "backlog",
          assignee: input.assignee ?? null,
          priority: input.priority ?? "medium",
          tags: input.tags ?? [],
          links: [],
          last_updated: now(),
          body: input.body ?? "",
          filename,
          filepath: `/fake/${filename}`,
        };
        state.tickets.push(ticket);
        dirty.add(filename);
        return { ...ticket };
      }
      case "update_ticket":
        return { ...applyUpdate(args.filename, args.input ?? {}) };
      case "delete_ticket": {
        state.tickets = state.tickets.filter((t) => t.filename !== args.filename);
        dirty.delete(args.filename);
        return null;
      }
      case "link_tickets": {
        const ticket = applyUpdate(
          state.tickets.find((t) => t.id === args.from)?.filename ?? "",
          {},
        );
        ticket.links = Array.from(new Set([...ticket.links, args.to]));
        return ticket;
      }
      case "unlink_tickets": {
        const ticket = applyUpdate(
          state.tickets.find((t) => t.id === args.from)?.filename ?? "",
          {},
        );
        ticket.links = ticket.links.filter((l) => l !== args.to);
        return ticket;
      }
      case "get_graph":
        return graph();
      case "git_load_pat":
        return "fake-pat";
      case "git_get_config": {
        const project = state.projects.find((p) => p.id === state.activeProjectId);
        return project
          ? {
              repo_url: project.repo_url,
              git_user_name: "Fake User",
              git_user_email: "fake@example.com",
              last_sync_at: project.last_sync_at,
            }
          : null;
      }
      case "git_status":
        return {
          current_sha: "fakesha",
          current_branch: "main",
          unpushed_count: 0,
          uncommitted_count: 0,
          is_clean: true,
        };
      case "git_current_remote_sha":
        return state.remoteSha;
      case "git_start_watcher":
      case "git_stop_watcher":
        return null;
      case "git_pull": {
        const answer = nextPull();
        if ("error" in answer) throw answer.error;
        return {
          head_sha: "fakesha",
          files_changed: [],
          commits_pulled: answer.commits_pulled,
          renamed_ids: [],
        };
      }
      case "git_push":
        return { head_sha: "fakesha" };
      case "git_commit_ticket":
        dirty.delete(args.filename);
        return {
          committed: true,
          head_sha: "fakesha",
          commit_message: `ticket: ${args.filename} ${args.action}`,
        };
      case "git_list_local_changes":
        return [...dirty];
      case "git_list_conflicts":
        return [...state.conflicts];
      case "git_read_conflict_version":
        return `# ${args.version} version\n`;
      case "git_resolve_conflict":
        return "";
      case "git_finish_resolution":
        state.conflicts = [];
        return "fakesha";
      case "git_abort_resolution":
        state.conflicts = [];
        return null;
      case "plugin:event|listen":
        return args.handler ?? nextCallbackId++;
      case "plugin:event|unlisten":
        return null;
      case "plugin:event|emit":
        return null;
      case "plugin:deep-link|get_current":
        return null;
      case "plugin:clipboard-manager|write_text":
        clipboard.push(String(args.text ?? ""));
        return null;
      default:
        unknownCommands.push(cmd);
        return null;
    }
  }

  (window as any).__GITTEAM_TEST__ = {
    state,
    clipboard,
    unknownCommands,
    /** Queues the answers the following `git_pull` calls will get. */
    enqueuePulls: (...answers: Array<{ commits_pulled: number } | { error: string }>) => {
      state.pulls = answers;
    },
    /** Emits a backend event to the listeners the app registered. */
    emit: (event: string, payload?: unknown) => {
      for (const cb of callbacks.values()) cb({ event, id: 0, payload });
    },
    callbacks,
  };

  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => handle(cmd, args),
    transformCallback: (
      callback: (payload?: unknown) => void,
      once = false,
    ) => {
      const id = nextCallbackId++;
      callbacks.set(id, (payload) => {
        callback(payload);
        if (once) callbacks.delete(id);
      });
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    convertFileSrc: (path: string) => path,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
  };
}
