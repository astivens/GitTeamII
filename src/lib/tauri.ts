import { invoke } from "@tauri-apps/api/core";
import type { CreateTicketInput, Ticket } from "../types/ticket";
import type { Graph } from "../types/graph";
import type {
  AddProjectInput,
  BoardCreateInput,
  CommitResult,
  GitConfig,
  GitStatus,
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
