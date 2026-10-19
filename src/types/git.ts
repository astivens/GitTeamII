export type SyncStatus =
  | "unconfigured"
  | "syncing"
  | "synced"
  | "error"
  | "conflict";

export interface GitConfig {
  repo_url: string;
  git_user_name: string;
  git_user_email: string;
  last_sync_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  repo_url: string;
  last_sync_at: string | null;
}

export interface AddProjectInput {
  url: string;
  pat: string;
  user_name: string;
  user_email: string;
}

/**
 * Creating a board: the repository itself is created by the backend on GitHub.
 * Every field is optional in practice — an empty `name` becomes
 * `<project>-board`, and an empty `pat` / `user_name` / `user_email` reuse the
 * active project's saved ones.
 */
export interface BoardCreateInput {
  name: string;
  pat: string;
  user_name: string;
  user_email: string;
}

export interface TestConnectionResult {
  ok: boolean;
  head_sha: string | null;
  repo_name: string;
  error: string | null;
}

export interface SetupResult {
  config: GitConfig;
  head_sha: string;
  files_count: number;
}

export interface PullResult {
  head_sha: string;
  files_changed: string[];
  commits_pulled: number;
  /** Display ids the pull had to renumber, so the app can report them. */
  renamed_ids: IdRename[];
}

/**
 * A repaired id collision: two people created the same display id offline and
 * the older ticket kept it.
 */
export interface IdRename {
  from: string;
  to: string;
  filename: string;
}

export interface PushResult {
  head_sha: string;
}

export interface CommitResult {
  committed: boolean;
  head_sha: string;
  commit_message: string | null;
}

export interface GitStatus {
  current_sha: string;
  current_branch: string;
  unpushed_count: number;
  uncommitted_count: number;
  is_clean: boolean;
}
