import { invoke } from "@tauri-apps/api/core";
import type { CreateTicketInput, Ticket } from "../types/ticket";
import type { Graph } from "../types/graph";
import type {
  AddProjectInput,
  BoardCreateInput,
  CommitResult,
  GitConfig,
  GitStatus,
  InviteDetails,
  LinkIntake,
  PendingInvitation,
  Project,
  PullResult,
  PushResult,
  SetupResult,
  TestConnectionResult,
} from "../types/git";

export async function initDataDir(): Promise<string> {
  return invoke<string>("init_data_dir");
}

export async function listProjects(): Promise<Project[]> {
  return invoke<Project[]>("list_projects");
}

export async function getActiveProject(): Promise<Project | null> {
  return invoke<Project | null>("get_active_project");
}

export async function addProject(input: AddProjectInput): Promise<Project> {
  return invoke<Project>("add_project", { input });
}

/**
 * Creates a private tickets repository on GitHub and links it as the active
 * project. A board is a repository of its own, so the application's repository
 * is never involved.
 */
export async function boardCreate(input: BoardCreateInput): Promise<Project> {
  return invoke<Project>("board_create", { input });
}

/**
 * The invitation for the active board: the string the user passes to whoever
 * they want on it. It carries no credential, because access to a private board
 * is granted on GitHub rather than delegated by the link.
 */
export async function boardInviteLink(): Promise<string> {
  return invoke<string>("board_invite_link");
}

/**
 * Reads a pasted invitation so the user can see which board it is for, and who
 * it came from, before anything is cloned.
 */
export async function boardParseInvite(text: string): Promise<InviteDetails> {
  return invoke<InviteDetails>("board_parse_invite", { text });
}

/**
 * Gives a GitHub user access to the active board, by their user name. It is the
 * owner's action, and the invitation stays pending until the other person
 * accepts it on GitHub.
 */
export async function boardInviteCollaborator(username: string): Promise<string> {
  return invoke<string>("board_invite_collaborator", { username });
}

/**
 * The invitations GitHub has pending for whoever owns this token. With a
 * repository url, only the invitation for that board comes back.
 */
export async function githubPendingInvitations(
  pat: string,
  repoUrl?: string,
): Promise<PendingInvitation[]> {
  return invoke<PendingInvitation[]>("github_pending_invitations", {
    pat,
    repoUrl: repoUrl ?? null,
  });
}

/** Accepts a pending invitation, so joining does not depend on GitHub's mail. */
export async function githubAcceptInvitation(
  pat: string,
  invitationId: number,
): Promise<void> {
  return invoke<void>("github_accept_invitation", { pat, invitationId });
}

/**
 * Turns the links the operating system handed to the app — the one the app was
 * launched with, and any that arrived while it was already running — into a
 * single decision. Which shape is an invitation is decided by the backend, the
 * same place that reads a pasted one, so the format is written once.
 */
export async function gitteamLinkIntake(
  urls: string[],
): Promise<LinkIntake> {
  return invoke<LinkIntake>("gitteam_link_intake", { urls });
}

export async function removeProject(projectId: string): Promise<void> {
  return invoke<void>("remove_project", { projectId });
}

export async function switchProject(projectId: string): Promise<Project> {
  return invoke<Project>("switch_project", { projectId });
}

export async function listTickets(): Promise<Ticket[]> {
  return invoke<Ticket[]>("list_tickets");
}

export async function readTicketRaw(filename: string): Promise<string> {
  return invoke<string>("read_ticket_raw", { filename });
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  return invoke<Ticket>("create_ticket", { input });
}

export async function updateTicket(
  filename: string,
  input: CreateTicketInput,
): Promise<Ticket> {
  return invoke<Ticket>("update_ticket", { filename, input });
}

export async function deleteTicket(filename: string): Promise<void> {
  await invoke<void>("delete_ticket", { filename });
}

export async function gitGetConfig(): Promise<GitConfig | null> {
  return invoke<GitConfig | null>("git_get_config");
}

export async function gitSaveConfig(
  config: GitConfig,
  pat: string,
): Promise<void> {
  await invoke<void>("git_save_config", { config, pat });
}

export async function gitDeleteConfig(): Promise<void> {
  await invoke<void>("git_delete_config");
}

export async function gitLoadPat(): Promise<string> {
  return invoke<string>("git_load_pat");
}

export async function gitTestConnection(
  url: string,
  pat: string,
): Promise<TestConnectionResult> {
  return invoke<TestConnectionResult>("git_test_connection", { url, pat });
}

export async function gitSetupRepo(
  config: GitConfig,
  pat: string,
): Promise<SetupResult> {
  return invoke<SetupResult>("git_setup_repo", { config, pat });
}

export async function gitPull(config: GitConfig): Promise<PullResult> {
  return invoke<PullResult>("git_pull", { config });
}

export async function gitPush(config: GitConfig): Promise<PushResult> {
  return invoke<PushResult>("git_push", { config });
}

export async function gitCommitTicket(
  filename: string,
  action: string,
  config: GitConfig,
): Promise<CommitResult> {
  return invoke<CommitResult>("git_commit_ticket", { filename, action, config });
}

export async function gitStatus(): Promise<GitStatus> {
  return invoke<GitStatus>("git_status");
}

export async function gitListLocalChanges(): Promise<string[]> {
  return invoke<string[]>("git_list_local_changes");
}

export async function gitListConflicts(): Promise<string[]> {
  return invoke<string[]>("git_list_conflicts");
}

export async function gitReadConflictVersion(
  filename: string,
  version: "local" | "remote",
): Promise<string> {
  return invoke<string>("git_read_conflict_version", { filename, version });
}

export async function gitResolveConflict(
  filename: string,
  resolution: "local" | "remote" | "both",
): Promise<string> {
  return invoke<string>("git_resolve_conflict", { filename, resolution });
}

export async function gitFinishResolution(): Promise<string> {
  return invoke<string>("git_finish_resolution");
}

export async function gitAbortResolution(): Promise<void> {
  await invoke<void>("git_abort_resolution");
}

export async function gitStartWatcher(): Promise<void> {
  await invoke<void>("git_start_watcher");
}

export async function gitStopWatcher(): Promise<void> {
  await invoke<void>("git_stop_watcher");
}

export async function gitCurrentRemoteSha(): Promise<string | null> {
  return invoke<string | null>("git_current_remote_sha");
}

// ----- graph (Fase 6F) -----

export async function linkTickets(from: string, to: string): Promise<Ticket> {
  return invoke<Ticket>("link_tickets", { from, to });
}

export async function unlinkTickets(from: string, to: string): Promise<Ticket> {
  return invoke<Ticket>("unlink_tickets", { from, to });
}

export async function getGraph(): Promise<Graph> {
  return invoke<Graph>("get_graph");
}
