use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::Utc;
use gray_matter::engine::YAML;
use gray_matter::{Matter, Pod};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::timeout;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Ticket {
    pub id: String,
    /// Stable identity, assigned when the ticket is created and never changed
    /// afterwards.
    ///
    /// The display id is what a person copies around, and it has to stay short.
    /// Two people working offline can still land on the same one, so this is
    /// what decides who keeps it and what makes that decision reproducible in
    /// every clone. It is optional and only emitted when present: tickets
    /// written before this scheme existed must keep parsing untouched.
    #[serde(default)]
    pub uid: Option<String>,
    pub title: String,
    pub status: String,
    pub assignee: Option<String>,
    pub priority: String,
    pub tags: Vec<String>,
    /// Related ticket ids declared in frontmatter (`links: [TKT-1041]`).
    #[serde(default)]
    pub links: Vec<String>,
    pub last_updated: String,
    pub body: String,
    pub filename: String,
    pub filepath: String,
}

#[derive(Deserialize, Debug)]
pub struct CreateTicketInput {
    pub title: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub body: Option<String>,
}

// ----- graph -----

#[derive(Serialize, Debug, Clone)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub tags: Vec<String>,
    pub filename: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Serialize, Debug)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitConfig {
    pub repo_url: String,
    pub git_user_name: String,
    pub git_user_email: String,
    #[serde(default)]
    pub last_sync_at: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct TestConnectionResult {
    pub ok: bool,
    pub head_sha: Option<String>,
    pub repo_name: String,
    pub error: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct SetupResult {
    pub config: GitConfig,
    pub head_sha: String,
    pub files_count: u32,
}

#[derive(Serialize, Debug)]
pub struct PullResult {
    pub head_sha: String,
    pub files_changed: Vec<String>,
    pub commits_pulled: u32,
    /// Display ids the pull had to renumber, for the app to report.
    #[serde(default)]
    pub renamed_ids: Vec<IdRename>,
}

#[derive(Serialize, Debug)]
pub struct PushResult {
    pub head_sha: String,
}

#[derive(Serialize, Debug)]
pub struct CommitResult {
    pub committed: bool,
    pub head_sha: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_message: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct GitStatus {
    pub current_sha: String,
    pub current_branch: String,
    pub unpushed_count: u32,
    pub uncommitted_count: u32,
    pub is_clean: bool,
}

// ----- project (multi-project support) -----

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub repo_url: String,
    pub last_sync_at: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct AddProjectInput {
    pub url: String,
    pub pat: String,
    pub user_name: String,
    pub user_email: String,
}

fn projects_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "could not resolve $HOME".to_string())?;
    Ok(home.join(".gitteam").join("projects"))
}

/// Container directory for one project: holds the metadata file and the
/// ticket-repo checkout as siblings.
fn project_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(projects_root()?.join(project_id))
}

/// The git checkout that holds the ticket markdown files.
///
/// This is deliberately a *subdirectory* of `project_dir`: `config.json` lives
/// next to it, not inside it. Keeping the metadata out of the checkout means
/// the ticket repo never has a permanently untracked `config.json` and
/// `git_status` reports a clean tree.
fn project_repo_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project_id)?.join("repo"))
}

fn project_config_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project_id)?.join("config.json"))
}

fn active_marker_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "could not resolve $HOME".to_string())?;
    Ok(home.join(".gitteam").join(".active"))
}

fn derive_project_id(url: &str) -> String {
    let name = extract_repo_name(url);
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed
    }
}

fn read_active_id() -> Result<Option<String>, String> {
    let path = active_marker_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("read active failed: {}", e))?;
    let id = content.trim().to_string();
    if id.is_empty() {
        Ok(None)
    } else {
        Ok(Some(id))
    }
}

fn write_active_id(project_id: &str) -> Result<(), String> {
    let path = active_marker_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir active dir failed: {}", e))?;
    }
    fs::write(&path, project_id).map_err(|e| format!("write active failed: {}", e))?;
    Ok(())
}

fn clear_active_id() -> Result<(), String> {
    let path = active_marker_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("clear active failed: {}", e))?;
    }
    Ok(())
}

/// Keyring service name for a project's PAT. Legacy (no project) keeps the
/// original `gitteam` service; each project gets `gitteam/<id>` so credentials
/// never leak between repositories.
fn pat_service(project_id: Option<&str>) -> String {
    match project_id {
        Some(id) => format!("gitteam/{}", id),
        None => "gitteam".to_string(),
    }
}

fn delete_pat_for_project(project_id: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(&pat_service(Some(project_id)), "github-pat")
        .map_err(keyring_err)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keyring_err(e)),
    }
}

fn load_project(project_id: &str) -> Result<Option<Project>, String> {
    let path = project_config_path(project_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("read project failed: {}", e))?;
    let gc: GitConfig =
        serde_json::from_str(&content).map_err(|e| format!("parse project failed: {}", e))?;
    Ok(Some(Project {
        id: project_id.to_string(),
        name: extract_repo_name(&gc.repo_url),
        repo_url: gc.repo_url,
        last_sync_at: gc.last_sync_at,
    }))
}

// ----- data dir -----

fn current_project_id_opt() -> Option<String> {
    read_active_id().ok().flatten()
}

/// The active project's id and container directory, or `None` when no marker
/// is set or the marker is stale (points at a project that no longer exists).
///
/// Keyed off the project *directory*, not `config.json`: during `add_project`
/// the repo is cloned before the config is written, so requiring the config
/// here would silently route that first write to the legacy paths.
fn active_project() -> Result<Option<(String, PathBuf)>, String> {
    let Some(id) = current_project_id_opt() else {
        return Ok(None);
    };
    let dir = project_dir(&id)?;
    if dir.is_dir() {
        Ok(Some((id, dir)))
    } else {
        Ok(None)
    }
}

/// The git repository GitTeam works on for the active project, falling back to
/// the legacy `~/.gitteam-data/` when no multi-project is set up. Every git
/// invocation (clone, fetch, pull, push, status, commit) runs here, so this is
/// the directory that has to contain `.git`.
fn repo_root() -> Result<PathBuf, String> {
    if let Some((id, _)) = active_project()? {
        return project_repo_dir(&id);
    }
    let home = dirs::home_dir().ok_or_else(|| "could not resolve $HOME".to_string())?;
    Ok(home.join(".gitteam-data"))
}

/// The directory that holds the ticket `.md` files.
///
/// Today this is always the repository root, so existing projects keep working
/// unchanged. It stays a separate concept from `repo_root()` because a project
/// may instead keep its tickets in a subdirectory of the repository
/// (`tickets/`). Every ticket-file operation goes through this function so that
/// change stays in one place.
fn tickets_dir() -> Result<PathBuf, String> {
    repo_root()
}

fn ensure_repo_root() -> Result<PathBuf, String> {
    let dir = repo_root()?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all failed: {}", e))?;
    Ok(dir)
}

/// Create the ticket directory (`tickets_dir()`), parents included.
fn ensure_tickets_dir() -> Result<PathBuf, String> {
    let dir = tickets_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all failed: {}", e))?;
    // Pre-Fase-6 layouts kept tickets in a `tickets/` subfolder that GitTeam no
    // longer reads. This is ticket-layout guidance, so it belongs here and not
    // on the git path. It goes away once `tickets_dir()` becomes a subfolder.
    let legacy = dir.join("tickets");
    if legacy.exists() && !dir.join(".git").exists() {
        eprintln!(
            "[gitteam] note: legacy ticket directory found at {} — Fase 2 ignores it. \
             Move .md files into {} if you want to keep them.",
            legacy.display(),
            dir.display()
        );
    }
    Ok(dir)
}

fn config_path() -> Result<PathBuf, String> {
    if let Some((id, _)) = active_project()? {
        return project_config_path(&id);
    }
    let home = dirs::home_dir().ok_or_else(|| "could not resolve $HOME".to_string())?;
    Ok(home.join(".gitteam-config.json"))
}

// ----- keyring -----

fn keyring_err(e: keyring::Error) -> String {
    match e {
        keyring::Error::NoEntry => {
            "No saved credentials. Please set up the repository again.".to_string()
        }
        keyring::Error::PlatformFailure(_)
        | keyring::Error::NoStorageAccess(_)
        | keyring::Error::Ambiguous(_) => "Could not access the system keyring. On Linux, make sure you have gnome-keyring or kwallet running.".to_string(),
        other => format!("Keyring error: {}", other),
    }
}

/// Service name for the currently active project, or the legacy service when
/// no project is active. `load_pat` backs `git_load_pat`, `git_pull`,
/// `git_push` and the background watcher, so making it project-aware is what
/// keeps every one of them working after a project is added.
fn active_pat_service() -> String {
    pat_service(current_project_id_opt().as_deref())
}

fn save_pat(pat: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(&active_pat_service(), "github-pat").map_err(keyring_err)?;
    entry.set_password(pat).map_err(keyring_err)
}

fn load_pat() -> Result<String, String> {
    let entry = keyring::Entry::new(&active_pat_service(), "github-pat").map_err(keyring_err)?;
    entry.get_password().map_err(keyring_err)
}

fn delete_pat() -> Result<(), String> {
    let entry = keyring::Entry::new(&active_pat_service(), "github-pat").map_err(keyring_err)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keyring_err(e)),
    }
}

// ----- git config file -----

fn read_git_config() -> Result<Option<GitConfig>, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("read config failed: {}", e))?;
    let config: GitConfig =
        serde_json::from_str(&content).map_err(|e| format!("parse config failed: {}", e))?;
    Ok(Some(config))
}

/// The config as it goes to disk: with the credential taken out of the url.
///
/// A url pasted into the connect form can carry a token — GitHub itself prints
/// `https://x-access-token:<token>@github.com/owner/repo.git` for a token clone —
/// and that token would then sit in plaintext in `config.json` for as long as
/// the project exists. The credential belongs to the keyring and nowhere else,
/// and it is not lost by dropping it here: `load_pat` still has it.
fn config_to_persist(config: &GitConfig) -> GitConfig {
    GitConfig {
        repo_url: strip_userinfo(&config.repo_url),
        ..config.clone()
    }
}

fn write_git_config(config: &GitConfig) -> Result<(), String> {
    let path = config_path()?;
    let content = serde_json::to_string_pretty(&config_to_persist(config))
        .map_err(|e| format!("serialize config failed: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("write config failed: {}", e))?;
    Ok(())
}

// ----- url helpers -----

fn with_authenticated_url(url: &str, pat: &str) -> String {
    let lowered = url.to_ascii_lowercase();
    // The scheme is matched case-insensitively. A url pasted as `HTTPS://…` used
    // to fall through to the `unwrap_or` arm and come out double-wrapped as
    // `https://<pat>@HTTPS://…`: a broken remote, and the token behind a shape
    // the redactor cannot recover once the first `/` closes the authority.
    let without_scheme = ["https://", "http://"]
        .iter()
        .find_map(|prefix| {
            lowered
                .strip_prefix(prefix)
                .map(|_| &url[prefix.len()..])
        })
        .unwrap_or(url);

    let (host_with_userinfo, path) = match without_scheme.find('/') {
        Some(i) => (&without_scheme[..i], &without_scheme[i..]),
        None => (without_scheme, ""),
    };

    let host = host_with_userinfo
        .rsplit_once('@')
        .map(|(_, h)| h)
        .unwrap_or(host_with_userinfo);

    let host_lower = host.to_ascii_lowercase();

    if host_lower.contains("github") {
        format!("https://x-access-token:{}@{}{}", pat, host, path)
    } else if host_lower.contains("gitlab") {
        format!("https://oauth2:{}@{}{}", pat, host, path)
    } else {
        format!("https://{}@{}{}", pat, host, path)
    }
}

/// `git -c` arguments that inject the credential into a single command.
///
/// A credentialed url handed to `git clone` or `git remote add` is persisted as
/// `remote.origin.url`, which parks the token in plaintext in the clone's
/// `.git/config`: it survives in backups, shows up in `git remote -v`, and
/// travels with any copy of the directory. The stored remote stays
/// credential-free instead, and each network command rewrites it to its
/// credentialed form for its own duration using git's own mechanism.
fn credentialed_remote_override(config_url: &str, pat: &str) -> Vec<String> {
    // A local path or any other non-HTTP remote carries no credential to
    // inject, and rewriting one would turn a working path into a broken url.
    if !(config_url.starts_with("http://") || config_url.starts_with("https://")) {
        return Vec::new();
    }
    let auth_url = with_authenticated_url(config_url, pat);
    let clean_url = strip_userinfo(&auth_url);
    vec![
        "-c".to_string(),
        format!("url.{}.insteadOf={}", auth_url, clean_url),
    ]
}

/// The override for the active project. Best effort on purpose: with no
/// connected project, no saved PAT, or a non-HTTP remote there is nothing to
/// inject, and a command that needs no credential must not fail because of it.
fn active_remote_override() -> Vec<String> {
    let Ok(Some(config)) = read_git_config() else {
        return Vec::new();
    };
    let Ok(pat) = load_pat() else {
        return Vec::new();
    };
    credentialed_remote_override(&config.repo_url, &pat)
}

/// Whether a `git` invocation talks to the remote and therefore needs the
/// credential. Keeping this list tight means local commands pay no keyring
/// lookup.
fn needs_credential(args: &[&str]) -> bool {
    matches!(
        args.first().copied(),
        Some("fetch" | "pull" | "push" | "ls-remote" | "clone")
    )
}

/// Rewrites a stored remote url that still carries userinfo to its clean form,
/// repairing clones made before the credential was kept out of git's config.
/// Returns whether the stored url had to be rewritten.
fn strip_stored_userinfo(dir: &Path) -> bool {
    let stored = match std::process::Command::new("git")
        .current_dir(dir)
        .args(["remote", "get-url", "origin"])
        .output()
    {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        _ => return false,
    };
    // Only HTTP(S) remotes carry a credential in their userinfo. In an SSH url
    // the `git@host` is part of the addressing, and in a local path an `@` is
    // just a character: "repairing" either one breaks a working remote.
    if !(stored.starts_with("http://") || stored.starts_with("https://")) {
        return false;
    }
    let clean = strip_userinfo(&stored);
    if clean == stored {
        return false;
    }
    std::process::Command::new("git")
        .current_dir(dir)
        .args(["remote", "set-url", "origin", &clean])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn strip_userinfo(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let (scheme, rest) = url.split_at(scheme_end + 3);
        if let Some(at_idx) = rest.find('@') {
            return format!("{}{}", scheme, &rest[at_idx + 1..]);
        }
    }
    url.to_string()
}

/// Takes the credential out of any url a message may be carrying.
///
/// The url this app hands git carries the token: as the password
/// (`https://x-access-token:<token>@host/…`) for GitHub, as the user
/// (`https://<token>@host/…`) for any other host. Git's own messages anonymise
/// the userinfo before printing a remote — measured, both forms come back as
/// `https://host/path` — so the reproduction lives on this side of the boundary:
/// `run_git_with_credential` prepends the `url.<credentialed>.insteadOf=`
/// override to `run_git`'s arguments and `run_git` reports those arguments.
/// Everything that can reach the user or a log goes through here, which closes
/// that and keeps a git or curl that prints the url as given from handing the
/// token back.
///
/// Only http(s) is touched, the rule the stored remote follows as well: in an
/// `ssh://git@host` url the `git@` is addressing, not a secret.
fn redact_credentials(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(sep) = rest.find("://") {
        let (head, after) = rest.split_at(sep + 3);
        out.push_str(head);
        // The scheme is what ends at `://` — "https" in `https://…`, and also in
        // the override's key, where it reads `url.https://…`.
        let scheme = head[..head.len() - 3].to_ascii_lowercase();
        let is_web = scheme.ends_with("http") || scheme.ends_with("https");
        // The authority ends at the first delimiter, so `scheme://user@host/path`
        // is redacted even though the `@` sits before the slash.
        let end = after
            .find(|c: char| matches!(c, '/' | '?' | '#' | ' ' | '\t' | '\n' | '\r' | '"' | '\''))
            .unwrap_or(after.len());
        let (authority, tail) = after.split_at(end);
        match (is_web, authority.rfind('@')) {
            (true, Some(at)) => {
                out.push_str("***");
                out.push_str(&authority[at..]);
            }
            _ => out.push_str(authority),
        }
        rest = tail;
    }
    out.push_str(rest);
    out
}

fn extract_repo_name(url: &str) -> String {
    let stripped = url.trim_end_matches('/').trim_end_matches(".git");
    let without_scheme = stripped
        .strip_prefix("https://")
        .or_else(|| stripped.strip_prefix("http://"))
        .or_else(|| stripped.strip_prefix("ssh://"))
        .or_else(|| stripped.strip_prefix("git@"))
        .unwrap_or(stripped);
    let after_colon = without_scheme
        .rsplit_once(':')
        .map(|(_, rest)| rest)
        .unwrap_or(without_scheme);
    after_colon
        .rsplit('/')
        .next()
        .unwrap_or(after_colon)
        .trim()
        .to_string()
}

// ----- git command helpers -----

fn build_git_cmd(dir: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd
}

fn build_git_cmd_with_user(dir: &Path, user_name: &str, user_email: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.arg("-c").arg(format!("user.name={}", user_name));
    cmd.arg("-c").arg(format!("user.email={}", user_email));
    cmd
}

async fn run_git(
    dir: &Path,
    args: &[&str],
    timeout_secs: u64,
    with_user: Option<(&str, &str)>,
) -> Result<String, String> {
    let mut cmd = match with_user {
        Some((n, e)) => build_git_cmd_with_user(dir, n, e),
        None => build_git_cmd(dir),
    };
    // The credential is injected per command and never stored: see
    // `credentialed_remote_override`.
    if needs_credential(args) {
        for a in active_remote_override() {
            cmd.arg(a);
        }
    }
    for a in args {
        cmd.arg(a);
    }
    // `run_git_with_credential` prepends the credential override to this same
    // slice, so the arguments can carry the token. They are redacted once, here,
    // and both messages below use that rendering: a failed `fetch` during setup
    // must not print the token it was given.
    let invoked = redact_credentials(&args.join(" "));
    let fut = cmd.output();
    let output = timeout(Duration::from_secs(timeout_secs), fut)
        .await
        .map_err(|_| format!("git {} timed out after {}s", invoked, timeout_secs))?
        .map_err(|e| format!("git spawn failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "git {} failed (exit {}): {}",
            invoked,
            output.status,
            redact_credentials(stderr.trim())
        ));
    }
    Ok(stdout)
}

/// Runs one network command with the credential of a project that is not active
/// yet. During setup the keyring entry and `config.json` are written *after* the
/// clone, so `active_remote_override` cannot resolve them: there the override
/// has to come from the values already in hand.
async fn run_git_with_credential(
    dir: &Path,
    config_url: &str,
    pat: &str,
    args: &[&str],
    timeout_secs: u64,
    with_user: Option<(&str, &str)>,
) -> Result<String, String> {
    let override_args = credentialed_remote_override(config_url, pat);
    let mut all: Vec<&str> = override_args.iter().map(|s| s.as_str()).collect();
    all.extend_from_slice(args);
    run_git(dir, &all, timeout_secs, with_user).await
}

async fn git_head(dir: &Path) -> Result<String, String> {
    let out = run_git(dir, &["rev-parse", "HEAD"], 10, None).await?;
    Ok(out.trim().to_string())
}

fn extract_ticket_id(filename: &str) -> String {
    if let Some(rest) = filename.strip_prefix("TKT-") {
        let end = rest
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(rest.len());
        format!("TKT-{}", &rest[..end])
    } else {
        filename.to_string()
    }
}

// ----- ticket file helpers -----

fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut last_was_dash = true;
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            out.push('-');
            last_was_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

fn generate_filename(id: &str, title: &str, taken: &[String]) -> String {
    let slug = slugify(title);
    let base = if slug.is_empty() {
        format!("{}.md", id)
    } else {
        format!("{}-{}.md", id, slug)
    };
    if !taken.contains(&base) {
        return base;
    }
    let (stem, ext) = match base.rfind('.') {
        Some(i) => (&base[..i], &base[i..]),
        None => (base.as_str(), ".md"),
    };
    let mut i = 2;
    loop {
        let candidate = format!("{}-{}{}", stem, i, ext);
        if !taken.contains(&candidate) {
            return candidate;
        }
        i += 1;
    }
}

fn parse_existing_ids(dir: &Path) -> Vec<u64> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut ids = vec![];
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            if let Some(id) = extract_id_from_content(&content) {
                if let Some(n) = id.strip_prefix("TKT-").and_then(|s| s.parse::<u64>().ok()) {
                    ids.push(n);
                }
            }
        }
    }
    ids
}

fn pod_to_json(pod: Pod) -> serde_json::Value {
    pod.into()
}

fn extract_id_from_content(content: &str) -> Option<String> {
    let parsed = Matter::<YAML>::new().parse(content);
    let data = parsed.data?;
    let value: serde_json::Value = pod_to_json(data);
    let map = value.as_object()?;
    let id = map.get("id")?;
    id.as_str().map(|s| s.to_string())
}

fn yaml_quote(s: &str) -> String {
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", escaped)
}

fn yaml_flow_seq(items: &[String]) -> String {
    let parts: Vec<String> = items.iter().map(|t| yaml_quote(t)).collect();
    format!("[{}]", parts.join(", "))
}

/// Normalize link targets: trim, uppercase, drop blanks, duplicates and
/// self-references. Input order is preserved so the stored frontmatter stays
/// stable for a given input.
fn normalize_links(links: &[String], self_id: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in links {
        let link = raw.trim().to_uppercase();
        if link.is_empty() || link == self_id {
            continue;
        }
        if !out.contains(&link) {
            out.push(link);
        }
    }
    out
}

fn render_frontmatter(t: &Ticket) -> String {
    let assignee_line = match &t.assignee {
        Some(a) => format!("assignee: {}\n", yaml_quote(a)),
        None => "assignee: null\n".to_string(),
    };
    let tags_line = format!("tags: {}\n", yaml_flow_seq(&t.tags));
    // Only emitted when links exist: adding `links: []` to every ticket would
    // rewrite the frontmatter of files that have nothing to link.
    let links_line = if t.links.is_empty() {
        String::new()
    } else {
        format!("links: {}\n", yaml_flow_seq(&t.links))
    };
    // Same criterion as `links`: a ticket with no identity is not rewritten
    // just to carry an empty field.
    let uid_line = match &t.uid {
        Some(uid) => format!("uid: {}\n", yaml_quote(uid)),
        None => String::new(),
    };
    format!(
        "---\nid: {id}\n{uid}title: {title}\nstatus: {status}\n{assignee}priority: {priority}\n{tags}{links}last_updated: {last_updated}\n---\n\n{body}",
        id = yaml_quote(&t.id),
        uid = uid_line,
        title = yaml_quote(&t.title),
        status = yaml_quote(&t.status),
        assignee = assignee_line,
        priority = yaml_quote(&t.priority),
        tags = tags_line,
        links = links_line,
        last_updated = yaml_quote(&t.last_updated),
        body = t.body,
    )
}

fn parse_ticket_file(path: &Path) -> Result<Ticket, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("read failed: {}", e))?;
    let parsed = Matter::<YAML>::new().parse(&content);

    let data_pod = parsed
        .data
        .ok_or_else(|| "no frontmatter".to_string())?;
    let value: serde_json::Value = pod_to_json(data_pod);
    let map = value
        .as_object()
        .ok_or_else(|| "frontmatter is not a mapping".to_string())?;

    let get_str = |k: &str| -> Result<String, String> {
        map.get(k)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("missing or invalid '{}'", k))
    };
    let get_opt_str = |k: &str| -> Result<Option<String>, String> {
        match map.get(k) {
            Some(v) if v.is_null() => Ok(None),
            Some(v) => v
                .as_str()
                .map(|s| Some(s.to_string()))
                .ok_or_else(|| format!("'{}' is not a string", k)),
            None => Ok(None),
        }
    };
    let get_tags = || -> Result<Vec<String>, String> {
        match map.get("tags") {
            None => Ok(vec![]),
            Some(v) => match v.as_array() {
                Some(arr) => arr
                    .iter()
                    .map(|item| {
                        item.as_str()
                            .map(|s| s.to_string())
                            .ok_or_else(|| "tag is not a string".to_string())
                    })
                    .collect(),
                None => Err("tags is not an array".to_string()),
            },
        }
    };

    let get_links = || -> Result<Vec<String>, String> {
        match map.get("links") {
            None => Ok(vec![]),
            Some(v) if v.is_null() => Ok(vec![]),
            Some(v) => match v.as_array() {
                Some(arr) => arr
                    .iter()
                    .map(|item| {
                        item.as_str()
                            .map(|s| s.to_string())
                            .ok_or_else(|| "link is not a string".to_string())
                    })
                    .collect(),
                None => Err("links is not an array".to_string()),
            },
        }
    };

    let id = get_str("id")?;
    let title = get_str("title")?;
    let status = get_str("status")?;
    let priority = get_str("priority")?;
    let last_updated = get_str("last_updated")?;
    let assignee = get_opt_str("assignee")?;
    let uid = get_opt_str("uid")?;
    let tags = get_tags()?;
    let links = get_links()?;

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "bad filename".to_string())?
        .to_string();
    let filepath = path.to_string_lossy().to_string();

    Ok(Ticket {
        id,
        uid,
        title,
        status,
        assignee,
        priority,
        tags,
        links,
        last_updated,
        body: parsed.content,
        filename,
        filepath,
    })
}

/// Crockford base32, the alphabet ULIDs use. `I`, `L`, `O` and `U` are left
/// out so an id read off a screen cannot be confused with `1`, `1`, `0` or each
/// other.
const ULID_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Render 16 bytes as a 26-character Crockford base32 string, most significant
/// bit first. 26 characters carry 130 bits, so the encoding starts with two
/// padding bits and the first character only ever uses three of its five.
fn encode_ulid(bytes: &[u8; 16]) -> String {
    let mut out = String::with_capacity(26);
    let mut acc: u32 = 0;
    let mut pending: u32 = 2;
    for &b in bytes.iter() {
        acc = ((acc << 8) | b as u32) & 0xfff;
        pending += 8;
        while pending >= 5 {
            pending -= 5;
            out.push(ULID_ALPHABET[((acc >> pending) & 0x1f) as usize] as char);
        }
    }
    out
}

/// Lay out a ULID's 16 bytes: 48 bits of milliseconds, then 80 bits of
/// entropy.
fn ulid_bytes(ms: u64, random: [u8; 10]) -> [u8; 16] {
    let mut bytes = [0u8; 16];
    for i in 0..6 {
        bytes[i] = ((ms >> (8 * (5 - i))) & 0xff) as u8;
    }
    bytes[6..].copy_from_slice(&random);
    bytes
}

/// A fresh ULID: a 48-bit millisecond timestamp followed by 80 random bits.
///
/// Lexicographic order matches creation order, which is what lets two clones
/// that generated the same display id agree on which ticket came first. The
/// random half is what keeps two tickets created in the same millisecond
/// distinct.
///
/// Entropy is not optional here: a ticket without a unique identity is exactly
/// the bug this exists to prevent, so an unavailable OS random source is an
/// error rather than a quietly weaker id.
fn new_ulid() -> Result<String, String> {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
        & 0xffff_ffff_ffff;
    let mut random = [0u8; 10];
    getrandom::fill(&mut random)
        .map_err(|e| format!("no system entropy available for a ticket id: {}", e))?;
    Ok(encode_ulid(&ulid_bytes(ms, random)))
}

fn next_ticket_id(dir: &Path) -> String {
    let ids = parse_existing_ids(dir);
    let n = ids.iter().max().copied().unwrap_or(999) + 1;
    format!("TKT-{:04}", n)
}

fn list_taken_filenames(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| {
                    let p = e.path();
                    if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("md") {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(|e| format!("write tmp failed: {}", e))?;
    fs::rename(&tmp, path).map_err(|e| format!("rename failed: {}", e))?;
    Ok(())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn sort_tickets_desc(tickets: &mut [Ticket]) {
    tickets.sort_by(|a, b| b.last_updated.cmp(&a.last_updated));
}

// ----- ticket commands (Fase 1) -----

#[tauri::command]
fn init_data_dir() -> Result<String, String> {
    let dir = ensure_tickets_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

/// Whether a Markdown file claims to be a ticket.
///
/// GitTeam owns top-level `TKT-…` files, so those always count. A ticket whose
/// file was renamed keeps working: a frontmatter `id` that starts with `TKT-`
/// says what the file is, whatever it is called. A README, a note or an
/// `AGENTS.md` claims nothing, so it is skipped in silence instead of being
/// reported as a malformed ticket.
fn claims_to_be_a_ticket(name: &str, content: &str) -> bool {
    if is_owned_ticket_path(name) {
        return true;
    }
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return false;
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            return false;
        }
        if let Some(value) = trimmed.strip_prefix("id:") {
            let value = value
                .trim_start()
                .trim_start_matches(|c| c == '"' || c == '\'');
            return value.starts_with("TKT-");
        }
    }
    false
}

/// Every `.md` file in `dir` that the scan treats as a ticket candidate.
///
/// GitTeam owns top-level ticket files and nothing else — see
/// `is_owned_ticket_path` and `claims_to_be_a_ticket` — so a README, a note or
/// a nested document is ordinary repository content, not a broken ticket, and
/// produces no warning.
fn ticket_scan_candidates(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read_dir failed: {}", e))?;
    let mut candidates = vec![];
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        if !claims_to_be_a_ticket(name, &content) {
            continue;
        }
        candidates.push(path);
    }
    candidates.sort();
    Ok(candidates)
}

fn load_all_tickets(dir: &Path) -> Result<Vec<Ticket>, String> {
    let mut tickets = vec![];
    for path in ticket_scan_candidates(dir)? {
        match parse_ticket_file(&path) {
            Ok(t) => {
                if t.id.starts_with("TKT-") {
                    tickets.push(t);
                } else {
                    eprintln!(
                        "[gitteam] skipping {}: id does not start with TKT-",
                        path.display()
                    );
                }
            }
            Err(e) => eprintln!("[gitteam] skipping malformed ticket {}: {}", path.display(), e),
        }
    }
    sort_tickets_desc(&mut tickets);
    Ok(tickets)
}

#[tauri::command]
fn list_tickets() -> Result<Vec<Ticket>, String> {
    let dir = ensure_tickets_dir()?;
    load_all_tickets(&dir)
}

#[tauri::command]
fn read_ticket_raw(filename: String) -> Result<String, String> {
    let dir = ensure_tickets_dir()?;
    let path = dir.join(&filename);
    if !path.exists() {
        return Err(format!("file not found: {}", filename));
    }
    fs::read_to_string(&path).map_err(|e| format!("read failed: {}", e))
}

#[tauri::command]
fn create_ticket(input: CreateTicketInput) -> Result<Ticket, String> {
    create_ticket_in(&ensure_tickets_dir()?, input)
}

/// Create a ticket inside `dir`. Separate from the command so tests can drive
/// it against a temporary directory.
fn create_ticket_in(dir: &Path, input: CreateTicketInput) -> Result<Ticket, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("title is required".to_string());
    }
    let id = next_ticket_id(dir);
    let taken = list_taken_filenames(dir);
    let filename = generate_filename(&id, title, &taken);

    let ticket = Ticket {
        id,
        uid: Some(new_ulid()?),
        title: title.to_string(),
        status: input.status.unwrap_or_else(|| "backlog".to_string()),
        assignee: input.assignee.and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        }),
        priority: input.priority.unwrap_or_else(|| "medium".to_string()),
        tags: input.tags.unwrap_or_default(),
        // New tickets start unlinked; links are added with `link_tickets`.
        links: vec![],
        last_updated: now_iso(),
        body: input.body.unwrap_or_default(),
        filename: filename.clone(),
        filepath: dir.join(&filename).to_string_lossy().to_string(),
    };

    let content = render_frontmatter(&ticket);
    atomic_write(&dir.join(&filename), &content)?;
    Ok(ticket)
}

#[tauri::command]
fn update_ticket(filename: String, input: CreateTicketInput) -> Result<Ticket, String> {
    update_ticket_in(&ensure_tickets_dir()?, &filename, input)
}

/// Update a ticket inside `dir`. Separate from the command so tests can drive
/// it against a temporary directory.
fn update_ticket_in(
    dir: &Path,
    filename: &str,
    input: CreateTicketInput,
) -> Result<Ticket, String> {
    let path = dir.join(filename);
    if !path.exists() {
        return Err(format!("file not found: {}", filename));
    }
    let existing = parse_ticket_file(&path)?;
    let title = input.title.trim();
    if title.is_empty() {
        return Err("title is required".to_string());
    }
    let updated = Ticket {
        id: existing.id,
        // A plain edit must never cost the ticket its identity.
        uid: existing.uid,
        title: title.to_string(),
        status: input.status.unwrap_or(existing.status),
        assignee: input
            .assignee
            .and_then(|s| {
                let t = s.trim().to_string();
                if t.is_empty() { None } else { Some(t) }
            })
            .or(existing.assignee),
        priority: input.priority.unwrap_or(existing.priority),
        tags: input.tags.unwrap_or(existing.tags),
        // Links are owned by `link_tickets` / `unlink_tickets`; a normal edit
        // must never drop them.
        links: existing.links,
        last_updated: now_iso(),
        body: input.body.unwrap_or(existing.body),
        filename: existing.filename,
        filepath: existing.filepath,
    };

    let content = render_frontmatter(&updated);
    atomic_write(&path, &content)?;
    Ok(updated)
}

#[tauri::command]
fn delete_ticket(filename: String) -> Result<(), String> {
    let dir = ensure_tickets_dir()?;
    let path = dir.join(&filename);
    if !path.exists() {
        return Err(format!("file not found: {}", filename));
    }
    fs::remove_file(&path).map_err(|e| format!("remove failed: {}", e))
}

// ----- graph commands (Fase 6F) -----

/// Resolve a ticket id such as `TKT-1041` to its file inside `dir`.
fn find_ticket_path_by_id(dir: &Path, id: &str) -> Result<PathBuf, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read_dir failed: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            if extract_id_from_content(&content).as_deref() == Some(id) {
                return Ok(path);
            }
        }
    }
    Err(format!("ticket not found: {}", id))
}

/// Add `to` to `from`'s links, rewriting `from`'s file.
///
/// The target must exist so the graph never grows phantom nodes. Ids are
/// expected to be normalized already by the command wrapper.
fn link_in_dir(dir: &Path, from: &str, to: &str) -> Result<Ticket, String> {
    if from == to {
        return Err("cannot link a ticket to itself".to_string());
    }
    let path = find_ticket_path_by_id(dir, from)?;
    // Resolve the target *before* writing so a typo cannot half-apply.
    find_ticket_path_by_id(dir, to)?;

    let mut ticket = parse_ticket_file(&path)?;
    if !ticket.links.iter().any(|l| l == to) {
        ticket.links.push(to.to_string());
    }
    ticket.links = normalize_links(&ticket.links, &ticket.id);
    ticket.last_updated = now_iso();
    atomic_write(&path, &render_frontmatter(&ticket))?;
    Ok(ticket)
}

fn unlink_in_dir(dir: &Path, from: &str, to: &str) -> Result<Ticket, String> {
    let path = find_ticket_path_by_id(dir, from)?;
    let mut ticket = parse_ticket_file(&path)?;
    ticket.links.retain(|l| l != to);
    ticket.last_updated = now_iso();
    atomic_write(&path, &render_frontmatter(&ticket))?;
    Ok(ticket)
}

/// An id collision that was repaired, so the app can tell the user about it.
#[derive(Serialize, Debug, Clone)]
pub struct IdRename {
    pub from: String,
    pub to: String,
    /// The filename the ticket lives in now.
    pub filename: String,
}

/// Total order deciding which of two tickets keeps a contested display id.
///
/// The older ticket wins. A file with no `uid` predates the identity scheme, so
/// it sorts before any ticket that has one, and `last_updated` orders those.
/// Tickets that do have a `uid` order by it, which is chronological because a
/// ULID's leading bits are a timestamp. `filename` closes the comparison so the
/// order is total: every clone has to pick the same winner, or they would keep
/// renumbering each other's tickets forever.
fn identity_key(t: &Ticket) -> (u8, &str, &str) {
    match t.uid.as_deref() {
        None => (0, t.last_updated.as_str(), t.filename.as_str()),
        Some(uid) => (1, uid, t.filename.as_str()),
    }
}

/// Repair tickets that ended up sharing a display id, which is what happens
/// when two people create a ticket offline and then merge.
///
/// A loser keeps its `uid` - that is its identity, and it is what makes the
/// decision above reproducible - and only its display id changes, together with
/// its filename and every `links:` entry that pointed at it.
///
/// `last_updated` is deliberately left alone. Nobody edited these tickets; the
/// app repaired a collision, and bumping the timestamp would both misreport
/// authorship and reorder the board.
fn reconcile_ticket_ids_in(dir: &Path) -> Result<Vec<IdRename>, String> {
    let tickets = load_all_tickets(dir)?;

    let mut by_id: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (index, ticket) in tickets.iter().enumerate() {
        by_id.entry(ticket.id.as_str()).or_default().push(index);
    }

    let mut taken = list_taken_filenames(dir);
    let mut next = tickets
        .iter()
        .filter_map(|t| t.id.strip_prefix("TKT-").and_then(|n| n.parse::<u64>().ok()))
        .max()
        .unwrap_or(999)
        + 1;

    // Decide everything before writing: a ticket can be renumbered *and* point
    // at another renumbered ticket, and both facts have to land in one write.
    let mut planned: Vec<(usize, String, String)> = vec![];
    for group in by_id.values() {
        if group.len() < 2 {
            continue;
        }
        let mut ordered = group.clone();
        ordered.sort_by(|a, b| identity_key(&tickets[*a]).cmp(&identity_key(&tickets[*b])));
        for &loser in &ordered[1..] {
            let ticket = &tickets[loser];
            let new_id = format!("TKT-{:04}", next);
            next += 1;
            let new_filename = generate_filename(&new_id, &ticket.title, &taken);
            taken.push(new_filename.clone());
            planned.push((loser, new_id, new_filename));
        }
    }
    if planned.is_empty() {
        return Ok(vec![]);
    }

    let remap: BTreeMap<&str, &str> = planned
        .iter()
        .map(|(index, new_id, _)| (tickets[*index].id.as_str(), new_id.as_str()))
        .collect();

    let mut renames = vec![];
    for (index, ticket) in tickets.iter().enumerate() {
        let renaming = planned.iter().find(|(i, _, _)| *i == index);

        let mut updated = ticket.clone();
        if let Some((_, new_id, new_filename)) = renaming {
            updated.id = new_id.clone();
            updated.filename = new_filename.clone();
            updated.filepath = dir.join(new_filename).to_string_lossy().to_string();
            renames.push(IdRename {
                from: ticket.id.clone(),
                to: new_id.clone(),
                filename: new_filename.clone(),
            });
        }

        let mut relinked = false;
        for link in updated.links.iter_mut() {
            if let Some(new_id) = remap.get(link.as_str()) {
                *link = (*new_id).to_string();
                relinked = true;
            }
        }

        if renaming.is_none() && !relinked {
            continue;
        }
        if renaming.is_some() {
            fs::rename(dir.join(&ticket.filename), dir.join(&updated.filename))
                .map_err(|e| format!("could not rename {}: {}", ticket.filename, e))?;
        }
        atomic_write(&dir.join(&updated.filename), &render_frontmatter(&updated))?;
    }

    Ok(renames)
}

/// Add `to` to `from`'s `links`. The link is recorded on the source ticket
/// only (like an Obsidian `[[wiki-link]]`); the graph renders the pair as one
/// undirected edge.
#[tauri::command]
fn link_tickets(from: String, to: String) -> Result<Ticket, String> {
    let dir = ensure_tickets_dir()?;
    let from = from.trim().to_uppercase();
    let to = to.trim().to_uppercase();
    link_in_dir(&dir, &from, &to)
}

#[tauri::command]
fn unlink_tickets(from: String, to: String) -> Result<Ticket, String> {
    let dir = ensure_tickets_dir()?;
    let from = from.trim().to_uppercase();
    let to = to.trim().to_uppercase();
    unlink_in_dir(&dir, &from, &to)
}

/// Build the undirected edge list from declared links.
///
/// Links pointing at tickets that do not exist are dropped (they would
/// otherwise render as phantom nodes), and each unordered pair is emitted
/// exactly once, so `A → B` plus `B → A` collapses into a single edge.
fn build_edges(tickets: &[Ticket]) -> Vec<GraphEdge> {
    let known: std::collections::HashSet<&str> =
        tickets.iter().map(|t| t.id.as_str()).collect();

    let mut edges: Vec<GraphEdge> = Vec::new();
    for t in tickets {
        for link in &t.links {
            if !known.contains(link.as_str()) {
                continue;
            }
            let (a, b) = if t.id.as_str() < link.as_str() {
                (t.id.clone(), link.clone())
            } else {
                (link.clone(), t.id.clone())
            };
            if !edges.iter().any(|e| e.source == a && e.target == b) {
                edges.push(GraphEdge { source: a, target: b });
            }
        }
    }
    edges
}

#[tauri::command]
fn get_graph() -> Result<Graph, String> {
    let dir = ensure_tickets_dir()?;
    let tickets = load_all_tickets(&dir)?;

    let nodes: Vec<GraphNode> = tickets
        .iter()
        .map(|t| GraphNode {
            id: t.id.clone(),
            title: t.title.clone(),
            status: t.status.clone(),
            priority: t.priority.clone(),
            tags: t.tags.clone(),
            filename: t.filename.clone(),
        })
        .collect();

    let edges = build_edges(&tickets);

    Ok(Graph { nodes, edges })
}

// ----- git config commands (Fase 2) -----

#[tauri::command]
async fn git_get_config() -> Result<Option<GitConfig>, String> {
    read_git_config()
}

#[tauri::command]
async fn git_save_config(config: GitConfig, pat: String) -> Result<(), String> {
    save_pat(&pat)?;
    write_git_config(&config)?;
    let dir = repo_root()?;
    if dir.join(".git").exists() {
        let _ = run_git(
            &dir,
            &["config", "user.name", &config.git_user_name],
            10,
            None,
        )
        .await;
        let _ = run_git(
            &dir,
            &["config", "user.email", &config.git_user_email],
            10,
            None,
        )
        .await;
    }
    Ok(())
}

#[tauri::command]
async fn git_delete_config() -> Result<(), String> {
    let _ = delete_pat();
    let path = config_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove config failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn git_load_pat() -> Result<String, String> {
    load_pat()
}

async fn git_test_connection_inner(url: &str, pat: &str) -> Result<TestConnectionResult, String> {
    let auth_url = with_authenticated_url(url, pat);
    let repo_name = extract_repo_name(url);
    let mut cmd = Command::new("git");
    cmd.arg("ls-remote").arg(&auth_url).arg("HEAD");
    let result = timeout(Duration::from_secs(15), cmd.output()).await;

    match result {
        Err(_) => Ok(TestConnectionResult {
            ok: false,
            head_sha: None,
            repo_name,
            error: Some("Connection timed out after 15s".to_string()),
        }),
        Ok(Err(e)) => Ok(TestConnectionResult {
            ok: false,
            head_sha: None,
            repo_name,
            error: Some(format!("Failed to run git: {}", e)),
        }),
        Ok(Ok(output)) if !output.status.success() => {
            // Git anonymises the userinfo in its own messages, and the url handed
            // to `ls-remote` here is the credentialed one: what this command says
            // goes to the connect form, so it is redacted as well.
            let stderr = redact_credentials(&String::from_utf8_lossy(&output.stderr))
                .trim()
                .to_string();
            let user_msg = if stderr.is_empty() {
                format!("git ls-remote failed with exit {}", output.status)
            } else {
                stderr
            };
            Ok(TestConnectionResult {
                ok: false,
                head_sha: None,
                repo_name,
                error: Some(user_msg),
            })
        }
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let head_sha = stdout
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().next())
                .map(|s| s.to_string());
            Ok(TestConnectionResult {
                ok: true,
                head_sha,
                repo_name,
                error: None,
            })
        }
    }
}

#[tauri::command]
async fn git_test_connection(url: String, pat: String) -> Result<TestConnectionResult, String> {
    git_test_connection_inner(&url, &pat).await
}

#[tauri::command]
async fn git_setup_repo(config: GitConfig, pat: String) -> Result<SetupResult, String> {
    let dir = repo_root()?;
    setup_repo_inner(dir, config, pat).await
}

/// Clone (or adopt) `config.repo_url` into `dir`, then persist the PAT and the
/// config for the active project.
///
/// Shared by `git_setup_repo` (recovery for the active project) and
/// `add_project` (a freshly created project directory). Callers must have
/// already activated the project so `save_pat` / `write_git_config` resolve to
/// its paths. `dir` is taken by value so the body below can keep using `&dir`.
async fn setup_repo_inner(
    dir: PathBuf,
    mut config: GitConfig,
    pat: String,
) -> Result<SetupResult, String> {
    // The active-project recovery path builds its GitConfig from `Project`,
    // which carries no user identity — so it arrives with empty name/email.
    // Backfill from the config already saved for this project instead of
    // overwriting a good identity (and the saved config) with empty values.
    if config.git_user_name.trim().is_empty() || config.git_user_email.trim().is_empty() {
        if let Some(saved) = read_git_config()? {
            if config.git_user_name.trim().is_empty() {
                config.git_user_name = saved.git_user_name;
            }
            if config.git_user_email.trim().is_empty() {
                config.git_user_email = saved.git_user_email;
            }
        }
    }

    let test = git_test_connection_inner(&config.repo_url, &pat).await?;
    if !test.ok {
        return Err(format!(
            "Connection test failed: {}",
            test.error.unwrap_or_else(|| "unknown error".to_string())
        ));
    }
    let remote_head = test.head_sha.clone().unwrap_or_default();

    let auth_url = with_authenticated_url(&config.repo_url, &pat);
    // What goes into `.git/config`: the same remote, without the credential.
    let clean_url = strip_userinfo(&auth_url);

    let is_git_repo = dir.join(".git").exists();
    let dir_is_empty = dir.exists()
        && fs::read_dir(&dir)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);

    // A missing directory *or* an empty one (e.g. a project dir just created by
    // `add_project`) is a fresh clone target. An existing non-empty directory
    // without `.git` is adopted via `git init` + fetch below.
    if !dir.exists() || (dir_is_empty && !is_git_repo) {
        fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all failed: {}", e))?;
        let mut cmd = Command::new("git");
        // Cloning through the credential override keeps the token out of the
        // clone's `.git/config`, where a credentialed url would be persisted.
        cmd.args(&credentialed_remote_override(&config.repo_url, &pat));
        cmd.arg("clone").arg(&clean_url).arg(&dir);
        // Cloning someone's real repository can legitimately take minutes: one
        // with a committed node_modules runs to tens of thousands of files. The
        // old 60s cap killed the clone mid-checkout, which left a complete
        // object store next to a half-populated worktree — the state that
        // afterwards reads as "everything was deleted".
        let output = match timeout(Duration::from_secs(900), cmd.output()).await {
            Err(_) => {
                let _ = fs::remove_dir_all(&dir);
                return Err(
                    "git clone timed out after 900s. Check your connection and try again — the partial clone was removed."
                        .to_string(),
                );
            }
            Ok(Err(e)) => {
                let _ = fs::remove_dir_all(&dir);
                return Err(format!("git clone failed to spawn: {}", e));
            }
            Ok(Ok(output)) => output,
        };
        if !output.status.success() {
            let stderr = redact_credentials(&String::from_utf8_lossy(&output.stderr))
                .trim()
                .to_string();
            let _ = fs::remove_dir_all(&dir);
            return Err(format!("git clone failed: {}", stderr));
        }
    } else if !dir.join(".git").exists() {
        let mut cmd = Command::new("git");
        cmd.current_dir(&dir);
        cmd.arg("init");
        let status = timeout(Duration::from_secs(15), cmd.status())
            .await
            .map_err(|_| "git init timed out".to_string())?
            .map_err(|e| format!("git init failed: {}", e))?;
        if !status.success() {
            return Err("git init failed".to_string());
        }

        let _ = run_git(
            &dir,
            &["config", "user.name", &config.git_user_name],
            10,
            None,
        )
        .await;
        let _ = run_git(
            &dir,
            &["config", "user.email", &config.git_user_email],
            10,
            None,
        )
        .await;

        let mut cmd = Command::new("git");
        cmd.current_dir(&dir);
        cmd.args(&["remote", "add", "origin", &clean_url]);
        let status = timeout(Duration::from_secs(15), cmd.status())
            .await
            .map_err(|_| "git remote add timed out".to_string())?
            .map_err(|e| format!("git remote add failed: {}", e))?;
        if !status.success() {
            return Err("git remote add failed".to_string());
        }

        let output =
            run_git_with_credential(&dir, &config.repo_url, &pat, &["fetch"], 300, None).await?;
        let _ = output;

        let reset_main = run_git(&dir, &["reset", "--hard", "origin/main"], 60, None).await;
        if reset_main.is_err() {
            let reset_master = run_git(&dir, &["reset", "--hard", "origin/master"], 15, None).await;
            if reset_master.is_err() {
                return Err("Neither origin/main nor origin/master exists in the remote repo. Please create the default branch.".to_string());
            }
        }
    } else {
        let existing = run_git(&dir, &["remote", "get-url", "origin"], 10, None)
            .await
            .map_err(|_| {
                "Could not read origin remote. Data directory is not properly initialized."
                    .to_string()
            })?;
        let existing_normalized = strip_userinfo(existing.trim());
        let config_normalized = strip_userinfo(&config.repo_url);
        if existing_normalized != config_normalized {
            return Err("Data directory already initialized with a different repository. Please disconnect first.".to_string());
        }

        // A clone made by an older build stored the credential in `.git/config`;
        // repair it before touching the remote again.
        if strip_stored_userinfo(&dir) {
            eprintln!("[gitteam] removed a credential from the stored remote url");
        }

        run_git_with_credential(&dir, &config.repo_url, &pat, &["fetch"], 300, None).await?;

        let pull_status = run_git_with_credential(
            &dir,
            &config.repo_url,
            &pat,
            &["pull", "--rebase", "--autostash"],
            300,
            Some((&config.git_user_name, &config.git_user_email)),
        )
        .await;
        if let Err(e) = pull_status {
            if e.to_lowercase().contains("conflict") {
                return Err(format!("CONFLICT: {}", e));
            }
            return Err(e);
        }
    }

    // Whichever path we took — fresh clone, init + fetch, or adopting an existing
    // checkout — the worktree has to actually contain the tracked files. A
    // half-populated checkout is not a usable project: every ticket write would
    // look like a mass deletion, and one sync could publish it.
    let missing = missing_tracked_files(&dir).await?;
    if !missing.is_empty() {
        return Err(format!(
            "the local checkout is incomplete: {} tracked file(s) are missing from the worktree ({}). Disconnect this project and link it again to get a fresh clone.",
            missing.len(),
            preview_paths(&missing)
        ));
    }

    // The merge driver is clone-local configuration, so it is set up wherever a
    // project is connected. Failing here is not fatal: without the driver the
    // same merge produces git's normal conflict, which the app can resolve.
    if let Err(e) = ensure_merge_driver(&dir).await {
        eprintln!("[gitteam] could not configure the ticket merge driver: {}", e);
    }

    save_pat(&pat)?;

    let mut config_to_save = config.clone();
    config_to_save.last_sync_at = Some(now_iso());
    // The value that is written and the value that is returned are the same one:
    // the frontend renders this url — the project chip's tooltip, the project
    // list — so a token pasted into the connect form must not travel back to a
    // screen after having been kept out of the file.
    let stored = config_to_persist(&config_to_save);
    write_git_config(&stored)?;

    let _ = run_git(
        &dir,
        &["config", "user.name", &config.git_user_name],
        10,
        None,
    )
    .await;
    let _ = run_git(
        &dir,
        &["config", "user.email", &config.git_user_email],
        10,
        None,
    )
    .await;

    let files_count = fs::read_dir(&dir)
        .map(|entries| entries.flatten().filter(|e| e.path().is_file()).count() as u32)
        .unwrap_or(0);

    let head = git_head(&dir).await.unwrap_or(remote_head);

    Ok(SetupResult {
        config: stored,
        head_sha: head,
        files_count,
    })
}

// ---------------------------------------------------------------------------
// Merge driver
// ---------------------------------------------------------------------------

/// The name git knows the ticket merge driver by, in the attributes file and in
/// the `[merge "..."]` config section.
const MERGE_DRIVER_NAME: &str = "gitteam-ticket";

/// The files the driver is registered for, relative to the repository root.
/// GitTeam only ever owns tickets, so the pattern names exactly those and
/// nothing else a repository may contain. It has to move together with
/// `tickets_dir()` if tickets ever live in a subdirectory.
const MERGE_DRIVER_PATTERN: &str = "TKT-*.md";

/// The command git runs when both sides changed the same ticket: this same
/// binary, told where the three versions are.
///
/// Separators are forward slashes even on Windows because git hands the command
/// to a shell, where a backslash is an escape character.
fn merge_driver_command(exe: &Path) -> String {
    let exe = exe.to_string_lossy().replace('\\', "/");
    format!("\"{}\" merge-driver %O %A %B", exe)
}

/// Entry point for the `merge-driver` argument. The exit code is the answer:
/// git reads 0 as "merged, `%A` holds the result" and anything else as "could
/// not merge", on which it falls back to its own merge and leaves a normal
/// conflict. Falling back is always safe, which is why every uncertainty here
/// ends in an error instead of a guess.
pub fn merge_driver_main(args: &[String]) -> i32 {
    if args.len() < 3 {
        eprintln!("[gitteam] merge-driver expects three paths: <base> <ours> <theirs>");
        return 1;
    }
    match merge_ticket_versions(Path::new(&args[0]), Path::new(&args[1]), Path::new(&args[2])) {
        Ok(()) => 0,
        Err(e) => {
            // stderr reaches the terminal of whoever ran the merge.
            eprintln!("[gitteam] leaving this conflict to git: {}", e);
            1
        }
    }
}

/// Merge the two sides of a ticket into `ours`, the path git reads the result
/// from.
///
/// `base` is empty when the two sides share no ancestor, which is an add/add:
/// the same filename created in two clones. That is a merge without history,
/// not a failure.
fn merge_ticket_versions(base: &Path, ours: &Path, theirs: &Path) -> Result<(), String> {
    let base_text =
        fs::read_to_string(base).map_err(|e| format!("could not read {}: {}", base.display(), e))?;

    // A side we cannot parse is a side we must not merge: git's own conflict is
    // strictly better than a file we invented.
    let ours_ticket =
        parse_ticket_file(ours).map_err(|e| format!("could not parse {}: {}", ours.display(), e))?;
    let theirs_ticket = parse_ticket_file(theirs)
        .map_err(|e| format!("could not parse {}: {}", theirs.display(), e))?;
    let base_ticket = if base_text.trim().is_empty() {
        None
    } else {
        Some(
            parse_ticket_file(base)
                .map_err(|e| format!("could not parse {}: {}", base.display(), e))?,
        )
    };

    let merged = merge_ticket_versions_of(base_ticket.as_ref(), &ours_ticket, &theirs_ticket);
    atomic_write(ours, &render_frontmatter(&merged))
}

/// Merge two versions of the same ticket, given their common ancestor when
/// there is one.
///
/// Per field it is the usual three-way rule: if both sides agree, that is the
/// value; if one side differs from the base, that side changed it; if both
/// changed it, the newer edit wins. Tags and links add a union to that rule,
/// because losing a tag or a reference is worse than keeping one somebody
/// removed. The body concatenates, so no text disappears.
fn merge_ticket_versions_of(base: Option<&Ticket>, ours: &Ticket, theirs: &Ticket) -> Ticket {
    let theirs_newer = theirs.last_updated > ours.last_updated;

    let scalar = |base_value: Option<&str>, a: &str, b: &str| -> String {
        if a == b {
            return a.to_string();
        }
        match base_value {
            Some(o) if o == a => b.to_string(),
            Some(o) if o == b => a.to_string(),
            _ => {
                if theirs_newer {
                    b.to_string()
                } else {
                    a.to_string()
                }
            }
        }
    };

    // The empty string stands in for "unset" so that clearing a field is one
    // more value to merge like any other.
    let optional = |base_value: Option<&str>, a: &str, b: &str| -> Option<String> {
        let picked = scalar(base_value, a, b);
        if picked.is_empty() {
            None
        } else {
            Some(picked)
        }
    };

    let list = |base_value: &[String], a: &[String], b: &[String]| -> Vec<String> {
        if a == b {
            return a.to_vec();
        }
        if base_value == a {
            return b.to_vec();
        }
        if base_value == b {
            return a.to_vec();
        }
        // Both sides changed it: keep both, ours first, without repeats.
        let mut out = a.to_vec();
        for item in b {
            if !out.contains(item) {
                out.push(item.clone());
            }
        }
        out
    };

    Ticket {
        id: scalar(base.map(|t| t.id.as_str()), &ours.id, &theirs.id),
        // Identity never changes, so two identities meeting at one file keep the
        // older one - the rule `reconcile_ticket_ids_in` uses for a collision -
        // rather than letting a clock decide who a ticket is.
        uid: match (&ours.uid, &theirs.uid) {
            (Some(a), Some(b)) if a != b => Some(if a < b { a.clone() } else { b.clone() }),
            (Some(a), _) => Some(a.clone()),
            (None, Some(b)) => Some(b.clone()),
            (None, None) => None,
        },
        title: scalar(base.map(|t| t.title.as_str()), &ours.title, &theirs.title),
        status: scalar(
            base.map(|t| t.status.as_str()),
            &ours.status,
            &theirs.status,
        ),
        assignee: optional(
            base.and_then(|t| t.assignee.as_deref()),
            ours.assignee.as_deref().unwrap_or(""),
            theirs.assignee.as_deref().unwrap_or(""),
        ),
        priority: scalar(
            base.map(|t| t.priority.as_str()),
            &ours.priority,
            &theirs.priority,
        ),
        tags: list(
            base.map(|t| t.tags.as_slice()).unwrap_or(&[]),
            &ours.tags,
            &theirs.tags,
        ),
        links: list(
            base.map(|t| t.links.as_slice()).unwrap_or(&[]),
            &ours.links,
            &theirs.links,
        ),
        last_updated: scalar(
            base.map(|t| t.last_updated.as_str()),
            &ours.last_updated,
            &theirs.last_updated,
        ),
        body: merge_bodies(base.map(|t| t.body.as_str()), &ours.body, &theirs.body),
        // git merges into the path it handed us, so the ticket keeps its name.
        filename: ours.filename.clone(),
        filepath: ours.filepath.clone(),
    }
}

/// The body is the part nobody can afford to lose. Two bodies that both changed
/// are kept, with the lines both of them share written once: a shared opening
/// paragraph is the same paragraph, and repeating it would bury the real
/// difference. What only one side has goes under a horizontal rule, which reads
/// as a separator in the app and in a plain editor. The base is only ever used
/// to answer "which side changed this", never to bring text back.
fn merge_bodies(base: Option<&str>, ours: &str, theirs: &str) -> String {
    if ours == theirs {
        return ours.to_string();
    }
    if base == Some(ours) {
        return theirs.to_string();
    }
    if base == Some(theirs) {
        return ours.to_string();
    }
    if ours.trim().is_empty() {
        return theirs.to_string();
    }
    if theirs.trim().is_empty() {
        return ours.to_string();
    }

    let a: Vec<&str> = ours.lines().collect();
    let b: Vec<&str> = theirs.lines().collect();
    let mut head = 0;
    while head < a.len() && head < b.len() && a[head] == b[head] {
        head += 1;
    }
    let mut tail = 0;
    while tail < a.len() - head
        && tail < b.len() - head
        && a[a.len() - 1 - tail] == b[b.len() - 1 - tail]
    {
        tail += 1;
    }

    let ours_only = a[head..a.len() - tail].join("\n");
    let theirs_only = b[head..b.len() - tail].join("\n");

    // One side brought nothing of its own, so the other side's text is the
    // whole answer and does not need a separator.
    if ours_only.trim().is_empty() {
        return theirs.to_string();
    }
    if theirs_only.trim().is_empty() {
        return ours.to_string();
    }

    let mut parts: Vec<String> = Vec::new();
    let shared_head = a[..head].join("\n");
    let shared_tail = a[a.len() - tail..].join("\n");
    if !shared_head.trim().is_empty() {
        parts.push(shared_head);
    }
    parts.push(ours_only);
    parts.push("---".to_string());
    parts.push(theirs_only);
    if !shared_tail.trim().is_empty() {
        parts.push(shared_tail);
    }

    let mut merged = parts.join("\n\n");
    if ours.ends_with('\n') {
        merged.push('\n');
    }
    merged
}

/// Configure this clone so ticket files merge with the driver above.
///
/// Both pieces live inside the clone's `.git` - the attributes line and the
/// `[merge]` section - so the repository the user shares gains no tracked file,
/// and a teammate without GitTeam simply gets git's normal conflict.
///
/// Idempotent; returns whether it changed anything.
async fn ensure_merge_driver(repo: &Path) -> Result<bool, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("could not locate the gitteam binary: {}", e))?;
    ensure_merge_driver_with(repo, &merge_driver_command(&exe)).await
}

/// The command is a parameter so tests can register something they can actually
/// run instead of pointing git at the test binary itself.
async fn ensure_merge_driver_with(repo: &Path, command: &str) -> Result<bool, String> {
    // Asking git where `.git` really is also covers a worktree or a submodule,
    // where `.git` is a file pointing somewhere else.
    let git_dir = run_git(repo, &["rev-parse", "--absolute-git-dir"], 15, None)
        .await
        .map(|out| PathBuf::from(out.trim()))
        .map_err(|_| "not a git repository".to_string())?;

    let mut changed = false;

    let attributes = git_dir.join("info").join("attributes");
    let rule = format!("{} merge={}", MERGE_DRIVER_PATTERN, MERGE_DRIVER_NAME);
    let existing = fs::read_to_string(&attributes).unwrap_or_default();
    if !existing.lines().any(|line| line.trim() == rule.as_str()) {
        // Append: the file may already carry rules of the user's own.
        let mut next = existing;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str("# Written by GitTeam, never tracked: merge two versions of one ticket file.\n");
        next.push_str(&rule);
        next.push('\n');
        atomic_write(&attributes, &next)?;
        changed = true;
    }

    let key = format!("merge.{}.driver", MERGE_DRIVER_NAME);
    let configured = run_git(repo, &["config", "--get", &key], 15, None)
        .await
        .unwrap_or_default();
    if configured.trim() != command {
        run_git(repo, &["config", &key, command], 15, None).await?;
        changed = true;
    }

    Ok(changed)
}

#[tauri::command]
async fn git_pull(config: GitConfig) -> Result<PullResult, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository. Please reconnect.".to_string());
    }

    // Before the pull, so this pull's own merge uses it: a project connected
    // before the driver existed would otherwise stay without it until somebody
    // linked it again. Failing is not fatal - the same merge just becomes a
    // normal conflict.
    if let Err(e) = ensure_merge_driver(&dir).await {
        eprintln!("[gitteam] could not configure the ticket merge driver: {}", e);
    }

    // Same reason as the driver above: a clone made by an older build stored the
    // credential in `.git/config`, and this is the run that clears it.
    if strip_stored_userinfo(&dir) {
        eprintln!("[gitteam] removed a credential from the stored remote url");
    }

    run_git(&dir, &["fetch"], 300, None).await?;

    let count_output = run_git(&dir, &["log", "HEAD..@{u}", "--oneline"], 60, None)
        .await
        .unwrap_or_default();
    let commits_pulled = if count_output.trim().is_empty() {
        0
    } else {
        count_output.lines().count() as u32
    };

    // A pull killed mid-rebase leaves the repository in a half-applied state, so
    // this gets the same generous budget as the clone rather than a 30s cap.
    let pull = run_git(
        &dir,
        &["pull", "--rebase", "--autostash"],
        300,
        Some((&config.git_user_name, &config.git_user_email)),
    )
    .await;

    if let Err(e) = pull {
        let lower = e.to_lowercase();
        if lower.contains("conflict") {
            return Err(format!("CONFLICT: {}", e));
        }
        return Err(e);
    }

    let head_sha = git_head(&dir).await?;

    // Two people creating tickets offline can land on the same display id. The
    // repair is written to the worktree and left there: the sync flow that
    // asked for this pull commits and pushes local ticket changes right after,
    // and committing from inside a pull would be a surprise. A failure here is
    // reported but does not fail the pull, which did its own job.
    let renamed_ids = match reconcile_ticket_ids_in(&tickets_dir()?) {
        Ok(renamed) => renamed,
        Err(e) => {
            eprintln!("[gitteam] could not reconcile ticket ids: {}", e);
            vec![]
        }
    };

    let files_changed = if commits_pulled > 0 {
        let files_output =
            run_git(&dir, &["log", "-n", &commits_pulled.to_string(), "--name-only", "--format="], 10, None)
                .await
                .unwrap_or_default();
        files_output
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|s| s.to_string())
            .collect()
    } else {
        vec![]
    };

    Ok(PullResult {
        head_sha,
        files_changed,
        commits_pulled,
        renamed_ids,
    })
}

#[tauri::command]
async fn git_push(config: GitConfig) -> Result<PushResult, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository. Please reconnect.".to_string());
    }

    let upstream_check = run_git(
        &dir,
        &["rev-parse", "--abbrev-ref", "--symbolic", "@{u}"],
        30,
        None,
    )
    .await;

    // Never publish a change that is not a ticket change. The range covers every
    // commit this push would introduce, so a bad commit made earlier in the
    // branch cannot slip through either — publishing tickets is the only thing
    // this app is allowed to do with a repository it does not own.
    let base = match &upstream_check {
        Ok(upstream) => upstream.trim().to_string(),
        Err(_) => run_git(&dir, &["rev-parse", "--abbrev-ref", "origin/HEAD"], 30, None)
            .await
            .unwrap_or_default()
            .trim()
            .to_string(),
    };
    if !base.is_empty() {
        let range = format!("{}...HEAD", base);
        let changed = run_git(&dir, &["diff", "--name-only", &range], 120, None)
            .await
            .unwrap_or_default();
        let paths: Vec<String> = changed
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_string())
            .collect();
        let foreign = foreign_paths(&paths);
        if !foreign.is_empty() {
            return Err(format!(
                "refusing to push: this branch would change {} file(s) GitTeam does not own ({}). Fix the repository state manually before syncing.",
                foreign.len(),
                preview_paths(&foreign)
            ));
        }
    }

    let mut cmd = build_git_cmd_with_user(&dir, &config.git_user_name, &config.git_user_email);
    for a in active_remote_override() {
        cmd.arg(a);
    }
    if upstream_check.is_err() {
        cmd.args(&["push", "-u", "origin", "HEAD"]);
    } else {
        cmd.args(&["push", "origin", "HEAD"]);
    }

    let output = timeout(Duration::from_secs(300), cmd.output())
        .await
        .map_err(|_| "git push timed out after 60s".to_string())?
        .map_err(|e| format!("git push failed to spawn: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let lower = stderr.to_lowercase();
        if lower.contains("non-fast-forward") || lower.contains("rejected") {
            return Err(format!("REJECTED: {}", stderr));
        }
        return Err(format!("git push failed: {}", stderr));
    }

    let head_sha = git_head(&dir).await?;
    Ok(PushResult { head_sha })
}

/// Is `name` a file GitTeam is allowed to stage, commit and push?
///
/// GitTeam owns ticket files and nothing else in the data repository. A ticket
/// is a top-level `.md` file whose name carries the `TKT-` id prefix — exactly
/// how `load_all_tickets` recognises one and how `create_ticket` names one.
///
/// This predicate is a safety boundary, so it stays deliberately narrow. A
/// linked repository may be someone's real project: nested paths, other
/// extensions and other root files belong to whoever else uses that repo, and a
/// ticket save must never be able to stage their deletion.
fn is_owned_ticket_path(name: &str) -> bool {
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return false;
    }
    let Some(stem) = name.strip_suffix(".md") else {
        return false;
    };
    let Some(rest) = stem.strip_prefix("TKT-") else {
        return false;
    };
    matches!(rest.chars().next(), Some(c) if c.is_ascii_digit())
}

/// The members of `candidates` that GitTeam has no business touching.
fn foreign_paths(candidates: &[String]) -> Vec<String> {
    candidates
        .iter()
        .filter(|p| !is_owned_ticket_path(p))
        .cloned()
        .collect()
}

/// A short, human-readable sample of `paths` for error messages.
fn preview_paths(paths: &[String]) -> String {
    let mut shown: Vec<String> = paths.iter().take(3).cloned().collect();
    if paths.len() > shown.len() {
        shown.push(format!("+{} more", paths.len() - shown.len()));
    }
    shown.join(", ")
}

/// Parse `git status --porcelain` output and return the paths whose *worktree*
/// copy is gone (second status column is `D`).
///
/// A `git clone` that is killed part-way leaves a complete object store next to
/// a half-populated worktree, and every subsequent command then reads as
/// "everything was deleted". Detecting that is what keeps a broken checkout from
/// being adopted as a working project.
fn deleted_in_worktree_from_porcelain(output: &str) -> Vec<String> {
    output
        .lines()
        .filter(|l| l.len() > 2 && l.as_bytes()[1] == b'D')
        .map(|l| l.chars().skip(3).collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Tracked files that exist in `HEAD` but are missing from the worktree.
async fn missing_tracked_files(dir: &Path) -> Result<Vec<String>, String> {
    let output = run_git(
        dir,
        &["status", "--porcelain", "--untracked-files=no"],
        120,
        None,
    )
    .await?;
    Ok(deleted_in_worktree_from_porcelain(&output))
}

#[tauri::command]
async fn git_commit_ticket(
    filename: String,
    action: String,
    config: GitConfig,
) -> Result<CommitResult, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository. Please reconnect.".to_string());
    }

    // A ticket save may only ever touch a ticket file. Without this, whatever
    // else happens to be staged in the repository — a stale index, someone
    // else's code — would ride along into the commit and then into the push.
    if !is_owned_ticket_path(&filename) {
        return Err(format!(
            "refusing to commit {}: GitTeam only commits ticket files (TKT-*.md at the repository root)",
            filename
        ));
    }

    let add = run_git(&dir, &["add", "--", &filename], 60, None).await;
    if let Err(e) = add {
        return Err(format!("git add failed: {}", e));
    }

    let head_before = git_head(&dir).await.unwrap_or_default();

    // Scope both the check and the commit to this ticket so unrelated staged
    // work stays exactly where it is instead of being swept into the commit.
    let mut diff_cmd = build_git_cmd(&dir);
    diff_cmd.args(&["diff", "--cached", "--quiet", "--", &filename]);
    let diff_status = timeout(Duration::from_secs(60), diff_cmd.status())
        .await
        .map_err(|_| "git diff --cached timed out".to_string())?
        .map_err(|e| format!("git diff --cached failed: {}", e))?;

    if diff_status.success() {
        return Ok(CommitResult {
            committed: false,
            head_sha: head_before,
            commit_message: None,
        });
    }

    let id = extract_ticket_id(&filename);
    let commit_msg = format!("ticket: {} {}", id, action);

    let commit = run_git(
        &dir,
        &["commit", "-m", &commit_msg, "--", &filename],
        60,
        Some((&config.git_user_name, &config.git_user_email)),
    )
    .await;
    if let Err(e) = commit {
        return Err(format!("git commit failed: {}", e));
    }

    let upstream_check = run_git(
        &dir,
        &["rev-parse", "--abbrev-ref", "--symbolic", "@{u}"],
        10,
        None,
    )
    .await;

    let mut push_cmd =
        build_git_cmd_with_user(&dir, &config.git_user_name, &config.git_user_email);
    for a in active_remote_override() {
        push_cmd.arg(a);
    }
    if upstream_check.is_err() {
        push_cmd.args(&["push", "-u", "origin", "HEAD"]);
    } else {
        push_cmd.args(&["push", "origin", "HEAD"]);
    }

    let push_output = timeout(Duration::from_secs(60), push_cmd.output())
        .await
        .map_err(|_| "git push timed out after 60s".to_string())?
        .map_err(|e| format!("git push failed to spawn: {}", e))?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr).trim().to_string();
        let lower = stderr.to_lowercase();
        if lower.contains("non-fast-forward") || lower.contains("rejected") {
            return Err(format!("REJECTED: {}", stderr));
        }
        return Err(format!("git push failed: {}", stderr));
    }

    let new_head = git_head(&dir).await?;
    Ok(CommitResult {
        committed: true,
        head_sha: new_head,
        commit_message: Some(commit_msg),
    })
}

#[tauri::command]
async fn git_status() -> Result<GitStatus, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository.".to_string());
    }

    let current_sha = git_head(&dir).await?;

    let branch_output = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"], 10, None)
        .await
        .unwrap_or_else(|_| "unknown".to_string());
    let current_branch = branch_output.trim().to_string();

    let unpushed_output = run_git(&dir, &["log", "@{u}..", "--oneline"], 10, None).await;
    let unpushed_count = match unpushed_output {
        Ok(s) if s.trim().is_empty() => 0,
        Ok(s) => s.lines().count() as u32,
        Err(_) => 0,
    };

    let status_output = run_git(&dir, &["status", "--porcelain"], 120, None)
        .await
        .unwrap_or_default();
    let uncommitted_count = if status_output.trim().is_empty() {
        0
    } else {
        status_output.lines().count() as u32
    };

    Ok(GitStatus {
        current_sha,
        current_branch,
        unpushed_count,
        uncommitted_count,
        is_clean: uncommitted_count == 0,
    })
}

/// Local changes GitTeam is allowed to commit: ticket files only.
///
/// The caller loops over this list and commits each entry, so filtering here is
/// what stops a dirty repository — or a stale index that reports other people's
/// files as deleted — from being swept into ticket commits and pushed.
#[tauri::command]
async fn git_list_local_changes() -> Result<Vec<String>, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Ok(vec![]);
    }
    let output = run_git(&dir, &["status", "--porcelain"], 120, None)
        .await
        .unwrap_or_default();
    let files: Vec<String> = output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.chars().skip(3).collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .filter(|s| is_owned_ticket_path(s))
        .collect();
    Ok(files)
}

// ----- conflict resolution commands (Fase 4) -----

/// Return the list of unmerged (conflicted) files. An empty list means there are
/// no conflicts (or we are not in a rebase/merge state).
#[tauri::command]
async fn git_list_conflicts() -> Result<Vec<String>, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Ok(vec![]);
    }
    let output = run_git(&dir, &["diff", "--name-only", "--diff-filter=U"], 120, None)
        .await
        .unwrap_or_default();
    let files: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(files)
}

/// Read one side of a conflicted file. `version` is "local" (working tree) or
/// "remote" (HEAD). Returns an empty string when the file does not exist in
/// that version (e.g. it was deleted on the other side).
#[tauri::command]
async fn git_read_conflict_version(filename: String, version: String) -> Result<String, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository.".to_string());
    }
    match version.as_str() {
        "local" => {
            let path = dir.join(&filename);
            if !path.exists() {
                return Ok(String::new());
            }
            fs::read_to_string(&path).map_err(|e| format!("read failed: {}", e))
        }
        "remote" => match run_git(&dir, &["show", &format!("HEAD:{}", filename)], 10, None).await {
            Ok(content) => Ok(content),
            Err(_) => Ok(String::new()),
        },
        other => Err(format!("unknown version '{}', expected 'local' or 'remote'", other)),
    }
}

/// Resolve a single conflicted file. `resolution` is "local", "remote" or
/// "both". For "both", the HEAD version is saved next to the conflicted file
/// with a `.remote.md` suffix (with collision suffix `-2`, `-3`, ...) and the
/// conflicted file is resolved with "ours". Returns the new file's name when
/// one was created, empty string otherwise.
#[tauri::command]
async fn git_resolve_conflict(filename: String, resolution: String) -> Result<String, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository.".to_string());
    }

    match resolution.as_str() {
        "local" => {
            run_git(&dir, &["checkout", "--ours", &filename], 10, None).await?;
            run_git(&dir, &["add", &filename], 10, None).await?;
            Ok(String::new())
        }
        "remote" => {
            run_git(&dir, &["checkout", "--theirs", &filename], 10, None).await?;
            run_git(&dir, &["add", &filename], 10, None).await?;
            Ok(String::new())
        }
        "both" => {
            // Naming convention: `<stem>.remote.md` where `<stem>` is the
            // conflicted filename without its trailing `.md`. Collisions get
            // a `-2`, `-3`, ... suffix before the extension (matching the
            // project's `withCollisionSuffix` pattern).
            //
            // Example: `TKT-0001-foo.md` → `TKT-0001-foo.remote.md`,
            //          next collision       → `TKT-0001-foo.remote-2.md`
            let stem = filename
                .strip_suffix(".md")
                .unwrap_or(filename.as_str());
            let remote_filename = {
                let mut candidate = format!("{}.remote.md", stem);
                let mut i = 2;
                while dir.join(&candidate).exists() {
                    candidate = format!("{}.remote-{}.md", stem, i);
                    i += 1;
                }
                candidate
            };

            // Capture HEAD's version of the conflicted file
            let remote_content = run_git(
                &dir,
                &["show", &format!("HEAD:{}", filename)],
                10,
                None,
            )
            .await?;
            let remote_path = dir.join(&remote_filename);
            fs::write(&remote_path, &remote_content)
                .map_err(|e| format!("write remote copy failed: {}", e))?;

            // Resolve the conflicted file by keeping our local version
            run_git(&dir, &["checkout", "--ours", &filename], 10, None).await?;
            run_git(&dir, &["add", &filename], 10, None).await?;
            run_git(&dir, &["add", &remote_filename], 10, None).await?;
            Ok(remote_filename)
        }
        other => Err(format!(
            "unknown resolution '{}', expected 'local', 'remote' or 'both'",
            other
        )),
    }
}

/// Finish an in-progress rebase or merge after all conflicts are resolved.
/// Returns the new HEAD SHA. Errors out when not in a rebase/merge state.
#[tauri::command]
async fn git_finish_resolution() -> Result<String, String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository.".to_string());
    }

    let config = read_git_config()?.unwrap_or(GitConfig {
        repo_url: String::new(),
        git_user_name: String::new(),
        git_user_email: String::new(),
        last_sync_at: None,
    });

    let in_rebase = run_git(&dir, &["rev-parse", "--git-path", "REBASE_HEAD"], 5, None)
        .await
        .is_ok();
    let in_merge = !in_rebase
        && run_git(&dir, &["rev-parse", "--git-path", "MERGE_HEAD"], 5, None)
            .await
            .is_ok();

    if in_rebase {
        run_git(
            &dir,
            &["-c", "core.editor=true", "rebase", "--continue"],
            30,
            Some((&config.git_user_name, &config.git_user_email)),
        )
        .await?;
    } else if in_merge {
        run_git(
            &dir,
            &["commit", "--no-edit"],
            15,
            Some((&config.git_user_name, &config.git_user_email)),
        )
        .await?;
    } else {
        return Err("Not in a rebase or merge state".to_string());
    }

    git_head(&dir).await
}

/// Abort an in-progress rebase or merge. No-op when not in either state.
#[tauri::command]
async fn git_abort_resolution() -> Result<(), String> {
    let dir = ensure_repo_root()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository.".to_string());
    }
    let in_rebase = run_git(&dir, &["rev-parse", "--git-path", "REBASE_HEAD"], 5, None).await;
    if in_rebase.is_ok() {
        let _ = run_git(&dir, &["rebase", "--abort"], 15, None).await;
        return Ok(());
    }
    let in_merge = run_git(&dir, &["rev-parse", "--git-path", "MERGE_HEAD"], 5, None).await;
    if in_merge.is_ok() {
        let _ = run_git(&dir, &["merge", "--abort"], 15, None).await;
        return Ok(());
    }
    Ok(())
}

// ----- background watcher (Fase 3) -----

#[derive(Default)]
pub struct WatcherState {
    pub task: Mutex<Option<JoinHandle<()>>>,
    pub last_known_sha: Arc<Mutex<Option<String>>>,
}

#[derive(Serialize, Clone)]
struct RemoteChangedPayload {
    sha: String,
    detected_at: String,
}

#[tauri::command]
async fn git_start_watcher(
    app: AppHandle,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    {
        let task_guard = state
            .task
            .lock()
            .map_err(|e| format!("watcher lock failed: {}", e))?;
        if task_guard.is_some() {
            return Ok(());
        }
    }

    let last_known_sha = Arc::clone(&state.last_known_sha);
    let app_handle = app.clone();

    let handle = tokio::spawn(async move {
        let mut is_first_iteration = true;
        loop {
            // Check that data dir exists and is a git repo
            let dir = match repo_root() {
                Ok(d) => d,
                Err(_) => {
                    eprintln!("[gitteam watcher] no data dir, sleeping 30s");
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    continue;
                }
            };

            if !dir.join(".git").exists() {
                tokio::time::sleep(Duration::from_secs(15)).await;
                continue;
            }

            // Need a saved config
            let config = match read_git_config() {
                Ok(Some(c)) => c,
                _ => {
                    tokio::time::sleep(Duration::from_secs(15)).await;
                    continue;
                }
            };

            // Need a saved PAT
            let pat = match load_pat() {
                Ok(p) => p,
                Err(_) => {
                    // No PAT — not an error, just skip this cycle.
                    tokio::time::sleep(Duration::from_secs(15)).await;
                    continue;
                }
            };

            let auth_url = with_authenticated_url(&config.repo_url, &pat);

            // `git ls-remote <url> HEAD` with 10s timeout
            let mut cmd = Command::new("git");
            cmd.arg("ls-remote").arg(&auth_url).arg("HEAD");
            let result = timeout(Duration::from_secs(10), cmd.output()).await;

            let new_sha: Option<String> = match result {
                Ok(Ok(output)) if output.status.success() => {
                    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                    stdout
                        .lines()
                        .next()
                        .and_then(|l| l.split_whitespace().next())
                        .map(|s| s.to_string())
                }
                Ok(Ok(output)) => {
                    let stderr = redact_credentials(&String::from_utf8_lossy(&output.stderr));
                    eprintln!(
                        "[gitteam watcher] ls-remote failed (exit {}): {}",
                        output.status,
                        stderr.trim()
                    );
                    None
                }
                Ok(Err(e)) => {
                    eprintln!("[gitteam watcher] ls-remote spawn failed: {}", e);
                    None
                }
                Err(_) => {
                    eprintln!("[gitteam watcher] ls-remote timed out after 10s");
                    None
                }
            };

            if let Some(sha) = new_sha {
                if is_first_iteration {
                    if let Ok(mut last) = last_known_sha.lock() {
                        *last = Some(sha);
                    }
                    is_first_iteration = false;
                } else {
                    let should_emit = {
                        let last = last_known_sha.lock().ok();
                        match last {
                            Some(g) => g.as_ref() != Some(&sha),
                            None => true,
                        }
                    };
                    if should_emit {
                        if let Ok(mut last) = last_known_sha.lock() {
                            *last = Some(sha.clone());
                        }
                        let payload = RemoteChangedPayload {
                            sha,
                            detected_at: now_iso(),
                        };
                        if let Err(e) = app_handle.emit("remote-changed", payload) {
                            eprintln!("[gitteam watcher] emit failed: {}", e);
                        }
                    }
                }
            }

            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    });

    let mut task_guard = state
        .task
        .lock()
        .map_err(|e| format!("watcher lock failed: {}", e))?;
    *task_guard = Some(handle);
    Ok(())
}

#[tauri::command]
async fn git_stop_watcher(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut task_guard = state
        .task
        .lock()
        .map_err(|e| format!("watcher lock failed: {}", e))?;
    if let Some(handle) = task_guard.take() {
        handle.abort();
        // Best-effort: do not await — the task will unwind on its next await point.
    }
    Ok(())
}

#[tauri::command]
async fn git_current_remote_sha(
    state: State<'_, WatcherState>,
) -> Result<Option<String>, String> {
    let guard = state
        .last_known_sha
        .lock()
        .map_err(|e| format!("watcher lock failed: {}", e))?;
    Ok(guard.clone())
}

// ----- project commands -----

#[tauri::command]
fn list_projects() -> Result<Vec<Project>, String> {
    let root = projects_root()?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut projects = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| format!("read_dir projects failed: {}", e))? {
        let entry = entry.map_err(|e| format!("dir entry failed: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if let Some(p) = load_project(&id)? {
            projects.push(p);
        }
    }
    projects.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(projects)
}

#[tauri::command]
fn get_active_project() -> Result<Option<Project>, String> {
    match read_active_id()? {
        Some(id) => load_project(&id),
        None => Ok(None),
    }
}

#[tauri::command]
async fn add_project(input: AddProjectInput) -> Result<Project, String> {
    // Resolve project_id, appending a suffix on collision. Collisions are
    // checked against the project *directory* so a partially created project
    // from an earlier failed attempt cannot be reused.
    let base_id = derive_project_id(&input.url);
    let mut id = base_id.clone();
    let mut counter: u32 = 2;
    while project_dir(&id)?.exists() {
        id = format!("{}-{}", base_id, counter);
        counter += 1;
    }

    // Fail fast with a clear message before touching the filesystem.
    let test = git_test_connection_inner(&input.url, &input.pat).await?;
    if !test.ok {
        return Err(test
            .error
            .unwrap_or_else(|| "connection test failed".to_string()));
    }

    let gc = GitConfig {
        repo_url: input.url.clone(),
        git_user_name: input.user_name.clone(),
        git_user_email: input.user_email.clone(),
        last_sync_at: None,
    };

    // Create the container dir (metadata + repo live side by side) and activate
    // the project *before* the clone so `save_pat` / `write_git_config` inside
    // `setup_repo_inner` resolve to this project's paths.
    let dir = project_dir(&id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir project dir failed: {}", e))?;
    write_active_id(&id)?;

    // Clone the repo and persist the PAT + config.
    let setup = match setup_repo_inner(project_repo_dir(&id)?, gc, input.pat).await {
        Ok(result) => result,
        Err(e) => {
            // Roll back so a failed add leaves no half-created project and no
            // dangling active marker.
            let _ = delete_pat_for_project(&id);
            let _ = fs::remove_dir_all(&dir);
            let _ = clear_active_id();
            return Err(e);
        }
    };

    Ok(Project {
        id,
        name: extract_repo_name(&input.url),
        repo_url: setup.config.repo_url,
        last_sync_at: setup.config.last_sync_at,
    })
}

// ----- GitHub API: creating a board -----

/// A failed GitHub call. Only a duplicate name is worth retrying.
struct GithubError {
    retryable: bool,
    message: String,
}

/// GitHub repository names accept letters, digits, `.`, `-` and `_`. Everything
/// else folds to `-`, runs collapse, and the ends are trimmed, so a pasted
/// label like `Royero Labs!` becomes a usable repository name.
fn sanitize_board_name(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches(|c| c == '-' || c == '.');
    if trimmed.is_empty() {
        "board".to_string()
    } else {
        trimmed.to_string()
    }
}

/// The name a board gets when the user does not pick one: the project it
/// belongs to, so `royero-labs` yields `royero-labs-board`.
fn default_board_name(project_name: Option<&str>) -> String {
    match project_name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => format!("{}-board", sanitize_board_name(name)),
        None => "gitteam-board".to_string(),
    }
}

/// `base`, `base-2`, `base-3`, … GitHub answers a duplicate name with 422, so
/// the caller walks these until one is accepted. Never returns an empty list.
fn board_name_candidates(base: &str, attempts: u32) -> Vec<String> {
    let mut names = vec![base.to_string()];
    for n in 2..=attempts.max(1) {
        names.push(format!("{}-{}", base, n));
    }
    names
}

/// Whether a failed create means "this name is taken" — the one failure worth
/// retrying with a different name.
fn github_name_taken(status: u16, body: &str) -> bool {
    status == 422 && body.contains("already exists")
}

/// The `message` of a GitHub error body, which reads better than the raw JSON,
/// or `None` when the body is not JSON or carries no message.
fn first_json_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value
        .get("errors")
        .and_then(|e| e.as_array())
        .and_then(|e| e.first())
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
        .or_else(|| value.get("message").and_then(|m| m.as_str()))
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
}

/// A short single-line form of an unexpected body, for an error message.
fn snippet(body: &str) -> String {
    let one_line = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.is_empty() {
        return "no response body".to_string();
    }
    let cut: String = one_line.chars().take(200).collect();
    if one_line.chars().count() > 200 {
        format!("{}…", cut)
    } else {
        cut
    }
}

/// Turns a failed GitHub response into something the user can act on. The case
/// worth the care is a token without the `repo` scope: GitHub answers 403, or a
/// deliberately vague 404, and never says which scope is missing — the scopes
/// header is the only honest source.
fn github_api_error(status: u16, oauth_scopes: Option<&str>, body: &str) -> String {
    let scopes = oauth_scopes.unwrap_or("").trim();
    let has_repo_scope = scopes.split(',').any(|s| s.trim() == "repo");
    match status {
        401 => "GitHub rejected the token. It may be expired or revoked: create a new one and try again.".to_string(),
        403 | 404 if !has_repo_scope => {
            // An absent header is normal for a fine-grained token, so "no
            // scopes" must not be read as "no permissions": say what is needed
            // instead of asserting what the token has.
            let explanation = if scopes.is_empty() {
                "GitHub reported no scopes for this token, which is normal for a fine-grained token. Creating a repository needs permission to create repositories; a classic token is missing the `repo` scope otherwise."
            } else {
                "The token is missing the `repo` scope, which is required to create a repository."
            };
            format!(
                "{} Scopes it has: {}.",
                explanation,
                if scopes.is_empty() { "none" } else { scopes }
            )
        }
        403 => "GitHub refused the request: this token's permissions do not allow creating a repository.".to_string(),
        422 => format!(
            "GitHub rejected the repository: {}.",
            first_json_message(body).unwrap_or_else(|| "the request was rejected".to_string())
        ),
        other => format!("GitHub returned {}: {}", other, snippet(body)),
    }
}

/// The token to create the board with: what the user just typed wins, otherwise
/// the active project's saved one.
fn choose_board_pat(input: Option<String>, stored: Option<String>) -> Result<String, String> {
    input
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .or_else(|| {
            stored
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
        })
        .ok_or_else(|| "Enter your GitHub token to create the board.".to_string())
}

/// The git identity for the new board's commits: the form wins, otherwise the
/// active project's, otherwise the user has to fill it in.
fn choose_git_identity(
    input_name: Option<String>,
    input_email: Option<String>,
    config: Option<&GitConfig>,
) -> Result<(String, String), String> {
    let pick = |input: Option<String>, saved: Option<&str>| {
        input
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| {
                saved
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
            })
    };
    let name = pick(input_name, config.map(|c| c.git_user_name.as_str()))
        .ok_or_else(|| "Enter the git user name for this board.".to_string())?;
    let email = pick(input_email, config.map(|c| c.git_user_email.as_str()))
        .ok_or_else(|| "Enter the git user email for this board.".to_string())?;
    Ok((name, email))
}

/// The body of the create-repository call. It is its own function so the two
/// promises that matter here — the board is **private**, and it carries an
/// initial commit — are pinned by a test instead of only by a literal.
fn board_create_body(name: &str) -> serde_json::Value {
    serde_json::json!({
        "name": name,
        "private": true,
        "auto_init": true,
    })
}

/// Creates a private repository on GitHub and returns its clone url.
///
/// `auto_init` matters: an empty repository has no default branch, and the
/// clone that follows could not check anything out of it.
async fn github_create_repo(pat: &str, name: &str) -> Result<String, GithubError> {
    let fatal = |message: String| GithubError {
        retryable: false,
        message,
    };
    let client = github_client().map_err(fatal)?;

    let body = board_create_body(name).to_string();

    let response = github_request(
        &client,
        reqwest::Method::POST,
        "https://api.github.com/user/repos",
        pat,
    )
    .body(body)
    .send()
    .await
    .map_err(|e| fatal(format!("could not reach GitHub: {}", e)))?;

    let status = response.status().as_u16();
    let scopes = oauth_scopes(&response);
    let text = response.text().await.unwrap_or_default();

    if (200..300).contains(&status) {
        let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            fatal(format!(
                "GitHub created the repository but answered with something unreadable: {}",
                e
            ))
        })?;
        let clone_url = value
            .get("clone_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                fatal("GitHub created the repository but did not return a clone url.".to_string())
            })?;
        return Ok(clone_url.to_string());
    }

    Err(GithubError {
        retryable: github_name_taken(status, &text),
        message: github_api_error(status, scopes.as_deref(), &text),
    })
}

#[derive(serde::Deserialize)]
pub struct BoardCreateInput {
    /// Empty or absent falls back to `<project>-board`.
    pub name: Option<String>,
    /// Empty or absent falls back to the active project's saved token.
    pub pat: Option<String>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

/// Creates a board: a private repository on GitHub that holds only tickets, and
/// links it as a project through the same path as any other repository.
///
/// Sharing a board is sharing that repository, which is why the application's
/// own repository never participates: it stays a place for code.
#[tauri::command]
async fn board_create(input: BoardCreateInput) -> Result<Project, String> {
    let config = read_git_config()?;
    let pat = choose_board_pat(input.pat, load_pat().ok())?;
    let (user_name, user_email) =
        choose_git_identity(input.user_name, input.user_email, config.as_ref())?;

    let base = match input.name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(raw) => sanitize_board_name(raw),
        None => default_board_name(
            config
                .as_ref()
                .map(|c| extract_repo_name(&c.repo_url))
                .as_deref(),
        ),
    };

    let mut last_error = None;
    let mut created_url = None;
    for candidate in board_name_candidates(&base, 4) {
        match github_create_repo(&pat, &candidate).await {
            Ok(url) => {
                created_url = Some(url);
                break;
            }
            Err(e) if e.retryable => last_error = Some(e.message),
            Err(e) => return Err(e.message),
        }
    }
    let url = created_url.ok_or_else(|| {
        last_error.unwrap_or_else(|| "could not create the board repository".to_string())
    })?;

    // The repository exists on GitHub from here on, so any later failure has to
    // say so: otherwise the user is left with a repository nobody can find.
    add_project(AddProjectInput {
        url: url.clone(),
        pat,
        user_name,
        user_email,
    })
    .await
    .map_err(|e| {
        format!(
            "The board repository was created at {} but linking it failed: {}",
            url, e
        )
    })
}

// ----- Invitation links -----

/// Where an invitation points. Built on one side of the app and read on the
/// other, so both halves of the format live here and a round trip pins them.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct InviteDetails {
    pub repo_url: String,
    pub board: Option<String>,
    pub from: Option<String>,
}

const INVITE_PREFIX: &str = "gitteam://join";

/// A repository url as it may appear in an invitation. In an http(s) url the
/// userinfo is a credential whatever it holds — a token is written as the user
/// name — so it always goes. In any other scheme a plain user name is part of
/// the address (`ssh://git@host`), but a password is a password, so `user:secret@`
/// goes too. A scp-style `git@host:org/repo.git` has no userinfo section at all
/// and is left untouched.
fn invite_repo_url(repo_url: &str) -> String {
    let trimmed = repo_url.trim();
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        return strip_userinfo(trimmed);
    }
    match trimmed.split_once("://") {
        Some((scheme, rest)) => match rest.split_once('@') {
            Some((userinfo, host)) if userinfo.contains(':') => format!("{}://{}", scheme, host),
            _ => trimmed.to_string(),
        },
        None => trimmed.to_string(),
    }
}

/// Percent-encoding for the query of an invitation. Everything that is not an
/// unreserved character is escaped, so a space stays a `%20` and there is no
/// room for the ambiguity of form encoding.
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &byte in input.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

/// The other half of `percent_encode`. A malformed escape is reported rather
/// than guessed, and so is a sequence that is not valid UTF-8.
fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .ok_or_else(|| "The invitation link ends in the middle of an escape.".to_string())?;
            let value = std::str::from_utf8(hex)
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                .ok_or_else(|| {
                    format!(
                        "The invitation link has an invalid escape: %{}.",
                        String::from_utf8_lossy(hex)
                    )
                })?;
            out.push(value);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "The invitation link is not valid UTF-8.".to_string())
}

/// The invitation for a board: the string the user copies and passes on.
fn build_invite_link(repo_url: &str, board: &str, from: &str) -> String {
    format!(
        "{}?repo={}&board={}&from={}",
        INVITE_PREFIX,
        percent_encode(&invite_repo_url(repo_url)),
        percent_encode(board),
        percent_encode(from),
    )
}

/// Reads a link that may have arrived through any messenger, with whatever
/// whitespace that implies. Only the repository is required; the labels are
/// there to show the user what they are about to open.
fn parse_invite_link(text: &str) -> Result<InviteDetails, String> {
    let missing_repo = || "The invitation is incomplete: it does not say which board it is for.";
    let query = text
        .trim()
        .strip_prefix(INVITE_PREFIX)
        .ok_or_else(|| {
            "That is not a GitTeam invitation. A link looks like gitteam://join?repo=…".to_string()
        })?
        .strip_prefix('?')
        .ok_or_else(missing_repo)?;

    let mut repo_url = None;
    let mut board = None;
    let mut from = None;
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let value = percent_decode(value)?.trim().to_string();
        match key {
            "repo" => repo_url = Some(value),
            "board" => board = Some(value),
            "from" => from = Some(value),
            // Unknown parameters are ignored: a newer app may send more.
            _ => {}
        }
    }

    let repo_url = repo_url
        .filter(|url| !url.is_empty())
        .ok_or_else(missing_repo)?;

    Ok(InviteDetails {
        // Sanitised on the way in as well: a hand-edited link must not smuggle a
        // credential into the clone that follows.
        repo_url: invite_repo_url(&repo_url),
        board: board.filter(|label| !label.is_empty()),
        from: from.filter(|label| !label.is_empty()),
    })
}

/// The invitation for the active board. It carries no credential: access is
/// granted on GitHub, so a link that leaks grants nothing.
#[tauri::command]
fn board_invite_link() -> Result<String, String> {
    let config = read_git_config()?
        .ok_or_else(|| "There is no active board to invite anyone to.".to_string())?;
    Ok(build_invite_link(
        &config.repo_url,
        &extract_repo_name(&config.repo_url),
        &config.git_user_name,
    ))
}

/// Reads a pasted invitation so the user can see what it points to before
/// anything is cloned.
#[tauri::command]
fn board_parse_invite(text: String) -> Result<InviteDetails, String> {
    parse_invite_link(&text)
}

/// Lo que trajo el esquema `gitteam://`, ya decidido: una invitación es lo único
/// que abre la entrada a un board, y un link de GitTeam que no lo sea se
/// contesta en pantalla en vez de desaparecer sin decir nada.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct LinkIntake {
    /// La primera invitación de la lista, para mostrarla antes de clonar.
    pub invite: Option<String>,
    /// El primer link de GitTeam que no era una invitación, cuando no hubo
    /// ninguna: sirve para decir por qué no pasó nada.
    pub not_an_invitation: Option<String>,
}

/// El sistema operativo entrega lo que el usuario clickeó, que puede no ser una
/// invitación (`gitteam://` es nuestro y puede llevar otra cosa, o venir de una
/// versión que no conocemos) y puede llegar repetido, vacío o con espacios. La
/// decisión se toma una sola vez, acá, donde ya se sabe leer el formato: la UI
/// no repite el parser ni inventa un segundo criterio.
fn classify_received_links(urls: &[String]) -> LinkIntake {
    let mut first_other = None;
    for url in urls {
        let url = url.trim();
        if url.is_empty() {
            continue;
        }
        // Una invitación gana sobre cualquier otro link, aparezca antes o
        // después: es el único de los dos que hace algo, y con una en mano no
        // queda nada que reprocharle a los demás. Por eso los dos campos nunca
        // conviven.
        if parse_invite_link(url).is_ok() {
            return LinkIntake {
                invite: Some(url.to_string()),
                not_an_invitation: None,
            };
        }
        if first_other.is_none() {
            first_other = Some(url.to_string());
        }
    }
    LinkIntake {
        invite: None,
        not_an_invitation: first_other,
    }
}

/// Traduce los links con los que el sistema abrió (o despertó) la app. El
/// frontend llama a esto con lo que recibe del plugin de deep links, que en
/// Linux incluye el argumento con el que se lanzó la primera instancia.
#[tauri::command]
fn gitteam_link_intake(urls: Vec<String>) -> LinkIntake {
    classify_received_links(&urls)
}

// ----- Compartir un board: el acceso lo otorga el dueño, por @usuario -----

/// One place for the HTTP client GitHub's calls share, so the timeout is
/// decided once instead of in every call.
fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("could not start the HTTP client: {}", e))
}

/// The headers every GitHub call carries, as data rather than as a chain of
/// calls, so the contract can be pinned by a test.
fn github_headers(pat: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Authorization", format!("Bearer {}", pat)),
        ("Accept", "application/vnd.github+json".to_string()),
        ("X-GitHub-Api-Version", "2022-11-28".to_string()),
        ("User-Agent", "gitteam".to_string()),
    ]
}

fn github_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    pat: &str,
) -> reqwest::RequestBuilder {
    let mut request = client.request(method, url);
    for (name, value) in github_headers(pat) {
        request = request.header(name, value);
    }
    request
}

/// The scopes GitHub reports on a response, when it reports them: fine-grained
/// tokens say nothing, which is why their absence proves nothing.
fn oauth_scopes(response: &reqwest::Response) -> Option<String> {
    response
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string())
}

/// A GitHub user name as the person typed or pasted it, normalized, and refused
/// with a reason when GitHub could not have it. Saying why here beats spending a
/// call to be told.
fn normalize_github_username(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_start_matches('@').trim();
    if trimmed.is_empty() {
        return Err("Enter the GitHub user name to invite.".to_string());
    }
    if trimmed.len() > 39 {
        return Err("A GitHub user name has at most 39 characters.".to_string());
    }
    if trimmed.starts_with('-') || trimmed.ends_with('-') || trimmed.contains("--") {
        return Err(format!(
            "@{} is not a GitHub user name: it cannot begin or end with a hyphen, or repeat one.",
            trimmed
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(format!(
            "@{} is not a GitHub user name: only letters, digits and hyphens.",
            trimmed
        ));
    }
    Ok(trimmed.to_string())
}

/// The full name `owner/repo` of a GitHub remote, which is how the API names it.
/// `None` when the remote is not on GitHub: granting access by user name is a
/// GitHub operation, and elsewhere there is nothing to ask.
fn repo_full_name(repo_url: &str) -> Option<String> {
    let trimmed = repo_url.trim();
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .or_else(|| trimmed.strip_prefix("ssh://"))
        .or_else(|| trimmed.strip_prefix("git@"))
        .unwrap_or(trimmed);

    // The scp form has no scheme and separates host from path with a colon.
    let (authority, path) = match without_scheme.split_once(':') {
        Some((authority, path)) if !trimmed.contains("://") => (authority, path),
        _ => without_scheme.split_once('/')?,
    };

    // A remote that kept a credential carries it in the authority, and a host can
    // come with a port: the repository's name needs neither.
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host);
    if !host.eq_ignore_ascii_case("github.com") {
        return None;
    }

    // A url pasted by hand can carry a query or a fragment: neither is part of
    // the name, and leaving them in would ask GitHub about a repository that
    // does not exist.
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let path = path.trim_start_matches('/').trim_end_matches(".git");
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let owner = parts.next()?;
    let name = parts.next()?;
    Some(format!("{}/{}", owner, name))
}

/// The body of the add-collaborator call: write access, which is what working on
/// a board needs. Its own function so the promise is pinned by a test.
fn collaborator_invite_body() -> serde_json::Value {
    serde_json::json!({ "permission": "push" })
}

/// What to say when the call succeeded. GitHub answers 201 when it created an
/// invitation and 204 when the user was already a collaborator: two different
/// situations for whoever is looking at the screen.
fn collaborator_result_message(status: u16, username: &str) -> String {
    if status == 201 {
        format!(
            "Invitation sent to @{}: they have to accept it on GitHub before the clone works.",
            username
        )
    } else {
        format!("@{} already has access to this board.", username)
    }
}

/// The error of the add-collaborator call, with the one case that has a name of
/// its own: a user GitHub does not have. Everything else is explained by the
/// general mapping, which reads the body.
fn collaborator_error_message(
    status: u16,
    oauth_scopes: Option<&str>,
    body: &str,
    username: &str,
) -> String {
    match status {
        404 => format!(
            "GitHub has no user called @{}. Check the spelling of their user name.",
            username
        ),
        403 => {
            // The general mapping explains a 403 in terms of creating a
            // repository, which is not what this call does. Two refusals are
            // worth naming, and what the token reports is what tells them apart:
            // a classic token without the `repo` scope, and an account that is
            // simply not the one that manages this repository. A token that
            // reports no scopes is the second case, not the first: fine-grained
            // tokens report nothing, so "none" must not be read as "missing".
            let scopes = oauth_scopes.unwrap_or("").trim();
            let has_repo_scope = scopes.split(',').any(|s| s.trim() == "repo");
            let need = if !scopes.is_empty() && !has_repo_scope {
                "The token is missing the `repo` scope, which granting access needs."
            } else {
                "Only a token that can manage this repository may grant access: the one in use belongs to another account, or lacks permission to manage it."
            };
            format!(
                "GitHub refused to give @{} access to this board. {} (Scopes it has: {}.)",
                username,
                need,
                if scopes.is_empty() { "none reported" } else { scopes }
            )
        }
        _ => github_api_error(status, oauth_scopes, body),
    }
}

/// An invitation waiting on the invitee's side.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct PendingInvitation {
    pub id: u64,
    /// The full name `owner/repo`, which is how GitHub names it.
    pub repo: String,
    /// Who sent it, when GitHub says.
    pub from: Option<String>,
}

/// Reads what GitHub answers on `GET /user/repository_invitations`. An
/// invitation without a repository cannot be used for anything, so it is not
/// turned into something half-formed: it is reported.
fn pending_invitations_from_json(body: &str) -> Result<Vec<PendingInvitation>, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| format!("GitHub answered with something unreadable: {}", e))?;
    let items = value
        .as_array()
        .ok_or_else(|| "GitHub did not answer with a list of invitations.".to_string())?;

    let mut invitations = Vec::with_capacity(items.len());
    for item in items {
        let id = item
            .get("id")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| "An invitation from GitHub came without an identifier.".to_string())?;
        let repo = item
            .get("repository")
            .and_then(|v| v.get("full_name"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| "An invitation from GitHub came without a repository.".to_string())?;
        let from = item
            .get("inviter")
            .and_then(|v| v.get("login"))
            .and_then(|v| v.as_str())
            .map(|login| login.to_string());
        invitations.push(PendingInvitation {
            id,
            repo: repo.to_string(),
            from,
        });
    }
    Ok(invitations)
}

/// The invitation that belongs to this board, if it is among the pending ones.
/// GitHub does not distinguish case in repository names.
fn invitation_for_repo<'a>(
    invitations: &'a [PendingInvitation],
    repo: &str,
) -> Option<&'a PendingInvitation> {
    invitations
        .iter()
        .find(|invitation| invitation.repo.eq_ignore_ascii_case(repo))
}

/// Gives a GitHub user access to the board, by their user name (S5). It is the
/// owner's action: the credential is the active project's, and the invitation
/// stays pending until the other person accepts it.
#[tauri::command]
async fn board_invite_collaborator(username: String) -> Result<String, String> {
    let config = read_git_config()?
        .ok_or_else(|| "There is no active board to invite anyone to.".to_string())?;
    let repo = repo_full_name(&config.repo_url).ok_or_else(|| {
        "This board's repository is not on GitHub, so its access cannot be granted from here."
            .to_string()
    })?;
    let username = normalize_github_username(&username)?;
    let pat = choose_board_pat(None, load_pat().ok()).map_err(|_| {
        "This board has no saved GitHub token, so access cannot be granted from here.".to_string()
    })?;

    let client = github_client()?;
    let response = github_request(
        &client,
        reqwest::Method::PUT,
        &format!(
            "https://api.github.com/repos/{}/collaborators/{}",
            repo, username
        ),
        &pat,
    )
    .body(collaborator_invite_body().to_string())
    .send()
    .await
    .map_err(|e| format!("Could not reach GitHub: {}", e))?;

    let status = response.status().as_u16();
    let scopes = oauth_scopes(&response);
    let text = response.text().await.unwrap_or_default();

    if (200..300).contains(&status) {
        return Ok(collaborator_result_message(status, &username));
    }
    Err(collaborator_error_message(
        status,
        scopes.as_deref(),
        &text,
        &username,
    ))
}

/// The invitations GitHub has pending for whoever owns this credential. The
/// invitee looks them up with **their** token: the invitation is on their
/// account (S5). With a repository url, only the invitation for that board comes
/// back: joining a board does not need the rest of the list.
#[tauri::command]
async fn github_pending_invitations(
    pat: String,
    repo_url: Option<String>,
) -> Result<Vec<PendingInvitation>, String> {
    let pat = pat.trim().to_string();
    if pat.is_empty() {
        return Err("Your GitHub token is needed to look up your invitations.".to_string());
    }

    let client = github_client()?;
    let response = github_request(
        &client,
        reqwest::Method::GET,
        "https://api.github.com/user/repository_invitations",
        &pat,
    )
    .send()
    .await
    .map_err(|e| format!("Could not reach GitHub: {}", e))?;

    let status = response.status().as_u16();
    let scopes = oauth_scopes(&response);
    let text = response.text().await.unwrap_or_default();

    if !(200..300).contains(&status) {
        return Err(github_api_error(status, scopes.as_deref(), &text));
    }

    let invitations = pending_invitations_from_json(&text)?;
    match repo_url.as_deref().map(repo_full_name) {
        Some(Some(repo)) => Ok(invitation_for_repo(&invitations, &repo)
            .cloned()
            .into_iter()
            .collect()),
        Some(None) => Err(
            "This board's repository is not on GitHub, so there is no invitation to look for."
                .to_string(),
        ),
        None => Ok(invitations),
    }
}

/// Accepts a pending invitation. Without this, accepting depends on the mail
/// GitHub sends, and the flow should not depend on a mail (S5).
#[tauri::command]
async fn github_accept_invitation(pat: String, invitation_id: u64) -> Result<(), String> {
    let pat = pat.trim().to_string();
    if pat.is_empty() {
        return Err("Your GitHub token is needed to accept an invitation.".to_string());
    }

    let client = github_client()?;
    let response = github_request(
        &client,
        reqwest::Method::PATCH,
        &format!(
            "https://api.github.com/user/repository_invitations/{}",
            invitation_id
        ),
        &pat,
    )
    .send()
    .await
    .map_err(|e| format!("Could not reach GitHub: {}", e))?;

    let status = response.status().as_u16();
    let scopes = oauth_scopes(&response);
    let text = response.text().await.unwrap_or_default();

    if (200..300).contains(&status) {
        return Ok(());
    }
    Err(github_api_error(status, scopes.as_deref(), &text))
}

#[tauri::command]
fn remove_project(project_id: String) -> Result<(), String> {
    let was_active = read_active_id()?.as_deref() == Some(project_id.as_str());

    // Best-effort keyring delete
    let _ = delete_pat_for_project(&project_id);

    // Remove project dir
    let dir = project_dir(&project_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("rmdir project failed: {}", e))?;
    }

    if was_active {
        clear_active_id()?;
    }
    Ok(())
}

#[tauri::command]
fn switch_project(project_id: String) -> Result<Project, String> {
    let project = load_project(&project_id)?
        .ok_or_else(|| format!("project '{}' not found", project_id))?;
    write_active_id(&project_id)?;
    Ok(project)
}

// ----- runner -----

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // El primero de todos: en Linux y Windows el sistema no le entrega el
        // link a la app que ya está abierta, lanza una segunda instancia con la
        // url como argumento. Este plugin la detecta, le pasa ese argumento al
        // plugin de deep links (feature `deep-link`) y la cierra, así que el
        // click termina en la ventana que ya existe y no en una copia nueva.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // En un paquete el esquema lo declara el instalador; acá se registra
            // además a mano porque `tauri dev` corre sin instalar nada, y sin
            // registro el sistema nunca entrega el link. Es idempotente y el
            // plugin corrige el `Exec` si el binario se movió. Un fallo acá no
            // puede impedir que la app abra.
            #[cfg(target_os = "linux")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            init_data_dir,
            list_tickets,
            read_ticket_raw,
            create_ticket,
            update_ticket,
            delete_ticket,
            git_get_config,
            git_save_config,
            git_delete_config,
            git_load_pat,
            git_test_connection,
            git_setup_repo,
            git_pull,
            git_push,
            git_commit_ticket,
            git_status,
            git_list_local_changes,
            git_list_conflicts,
            git_read_conflict_version,
            git_resolve_conflict,
            git_finish_resolution,
            git_abort_resolution,
            git_start_watcher,
            git_stop_watcher,
            git_current_remote_sha,
            // Multi-project (Fase 6)
            list_projects,
            get_active_project,
            add_project,
            board_create,
            board_invite_link,
            board_parse_invite,
            // Deep link (T6)
            gitteam_link_intake,
            board_invite_collaborator,
            github_pending_invitations,
            github_accept_invitation,
            remove_project,
            switch_project,
            // Graph (Fase 6F)
            link_tickets,
            unlink_tickets,
            get_graph,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("gitteam-test-{}-{}", std::process::id(), name));
        p
    }

    fn sample_ticket(links: Vec<String>) -> Ticket {
        Ticket {
            id: "TKT-1041".to_string(),
            title: "Graph links".to_string(),
            status: "backlog".to_string(),
            assignee: None,
            priority: "medium".to_string(),
            tags: vec!["ui".to_string()],
            links,
            uid: None,
            last_updated: "2026-01-01T00:00:00Z".to_string(),
            body: "Body text\n".to_string(),
            filename: "TKT-1041-graph-links.md".to_string(),
            filepath: String::new(),
        }
    }

    #[test]
    fn frontmatter_round_trip_preserves_links() {
        let path = temp_path("links.md");
        let original = sample_ticket(vec!["TKT-1039".to_string(), "TKT-1000".to_string()]);
        fs::write(&path, render_frontmatter(&original)).unwrap();

        let parsed = parse_ticket_file(&path).unwrap();
        assert_eq!(parsed.links, vec!["TKT-1039".to_string(), "TKT-1000".to_string()]);
        assert_eq!(parsed.id, "TKT-1041");
        assert_eq!(parsed.tags, vec!["ui".to_string()]);
        // `Matter::parse` trims the trailing newline from the body.
        assert_eq!(parsed.body, "Body text");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn frontmatter_without_links_omits_the_key_and_parses_as_empty() {
        let path = temp_path("nolinks.md");
        let content = render_frontmatter(&sample_ticket(vec![]));
        assert!(
            !content.contains("links:"),
            "a ticket with no links must not gain a links key:\n{}",
            content
        );
        fs::write(&path, content).unwrap();

        let parsed = parse_ticket_file(&path).unwrap();
        assert!(parsed.links.is_empty());
        let _ = fs::remove_file(&path);
    }

    /// Files written before Fase 6F have no `links` key at all — they must
    /// still parse cleanly.
    #[test]
    fn legacy_frontmatter_without_links_key_parses() {
        let path = temp_path("legacy.md");
        let legacy = "---\nid: \"TKT-1000\"\ntitle: \"Legacy\"\nstatus: \"backlog\"\n\
assignee: null\npriority: \"low\"\ntags: [\"api\"]\nlast_updated: \"2025-01-01T00:00:00Z\"\n---\n\nOld body";
        fs::write(&path, legacy).unwrap();

        let parsed = parse_ticket_file(&path).unwrap();
        assert!(parsed.links.is_empty());
        assert_eq!(parsed.title, "Legacy");
        let _ = fs::remove_file(&path);
    }

    /// A tickets repository also holds notes and documentation. Those files are
    /// not broken tickets, so the scan must neither parse them nor warn about
    /// them.
    #[test]
    fn the_scan_only_looks_at_files_the_app_owns() {
        let dir = temp_path("scan");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("notes")).unwrap();

        fs::write(
            dir.join("TKT-1000-real.md"),
            render_frontmatter(&sample_ticket(vec![])),
        )
        .unwrap();
        fs::write(dir.join("README.md"), "# Board\n\nNotes live here.\n").unwrap();
        fs::write(dir.join("AGENTS.md"), "---\ntitle: agents\n---\n").unwrap();
        fs::write(
            dir.join("ticket-1001-manual.md"),
            "---\nid: NOTES-1\ntitle: manual\n---\n",
        )
        .unwrap();
        // A complete ticket whose file was renamed: it must stay listed.
        fs::write(
            dir.join("board-notes.md"),
            render_frontmatter(&ticket_with("TKT-1001", &[])),
        )
        .unwrap();
        fs::write(
            dir.join("notes").join("TKT-1002-nested.md"),
            render_frontmatter(&ticket_with("TKT-1002", &[])),
        )
        .unwrap();

        let names: Vec<String> = ticket_scan_candidates(&dir)
            .unwrap()
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(
            names,
            vec!["TKT-1000-real.md".to_string(), "board-notes.md".to_string()],
            "owned files and renamed tickets are candidates, documentation is not"
        );

        let tickets = load_all_tickets(&dir).unwrap();
        let mut ids: Vec<&str> = tickets.iter().map(|t| t.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["TKT-1001", "TKT-1041"], "a renamed ticket must not vanish");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn normalize_links_uppercases_dedupes_and_drops_self() {
        let input = vec![
            " tkt-1 ".to_string(),
            "TKT-1".to_string(),
            "TKT-1041".to_string(),
            "".to_string(),
            "TKT-2".to_string(),
        ];
        assert_eq!(
            normalize_links(&input, "TKT-1041"),
            vec!["TKT-1".to_string(), "TKT-2".to_string()]
        );
    }

    fn ticket_with(id: &str, links: &[&str]) -> Ticket {
        let mut t = sample_ticket(links.iter().map(|s| s.to_string()).collect());
        t.id = id.to_string();
        t
    }

    #[test]
    fn build_edges_collapses_reciprocal_links() {
        let a = ticket_with("TKT-1", &["TKT-2"]);
        let b = ticket_with("TKT-2", &["TKT-1"]);
        let edges = build_edges(&[a, b]);
        assert_eq!(edges.len(), 1, "A→B and B→A must be one edge: {:?}", edges);
    }

    #[test]
    fn build_edges_drops_links_to_unknown_tickets() {
        let a = ticket_with("TKT-1", &["TKT-999"]);
        assert!(build_edges(&[a]).is_empty());
    }

    #[test]
    fn build_edges_keeps_distinct_pairs() {
        let a = ticket_with("TKT-1", &["TKT-2", "TKT-3"]);
        let b = ticket_with("TKT-2", &[]);
        let c = ticket_with("TKT-3", &[]);
        assert_eq!(build_edges(&[a, b, c]).len(), 2);
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("gitteam-test-dir-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&p);
        p
    }

    fn write_ticket(dir: &Path, id: &str, links: &[&str]) {
        let mut t = sample_ticket(links.iter().map(|s| s.to_string()).collect());
        t.id = id.to_string();
        t.filename = format!("{}.md", id);
        fs::write(dir.join(&t.filename), render_frontmatter(&t)).unwrap();
    }

    #[test]
    fn link_in_dir_persists_the_link_and_the_graph_sees_the_edge() {
        let dir = unique_temp_dir("link");
        fs::create_dir_all(&dir).unwrap();
        write_ticket(&dir, "TKT-1", &[]);
        write_ticket(&dir, "TKT-2", &[]);

        let updated = link_in_dir(&dir, "TKT-1", "TKT-2").unwrap();
        assert_eq!(updated.links, vec!["TKT-2".to_string()]);

        // Read back from disk so this proves persistence, not just the return.
        let edges = build_edges(&load_all_tickets(&dir).unwrap());
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].source, "TKT-1");
        assert_eq!(edges[0].target, "TKT-2");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn link_in_dir_is_idempotent() {
        let dir = unique_temp_dir("link-idempotent");
        fs::create_dir_all(&dir).unwrap();
        write_ticket(&dir, "TKT-1", &[]);
        write_ticket(&dir, "TKT-2", &[]);

        link_in_dir(&dir, "TKT-1", "TKT-2").unwrap();
        link_in_dir(&dir, "TKT-1", "TKT-2").unwrap();

        let tickets = load_all_tickets(&dir).unwrap();
        let source = tickets.iter().find(|t| t.id == "TKT-1").unwrap();
        assert_eq!(source.links, vec!["TKT-2".to_string()]);
        assert_eq!(build_edges(&tickets).len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn link_in_dir_rejects_an_unknown_target_without_touching_the_source() {
        let dir = unique_temp_dir("link-unknown");
        fs::create_dir_all(&dir).unwrap();
        write_ticket(&dir, "TKT-1", &[]);

        let before = fs::read_to_string(dir.join("TKT-1.md")).unwrap();
        assert!(link_in_dir(&dir, "TKT-1", "TKT-999").is_err());
        let after = fs::read_to_string(dir.join("TKT-1.md")).unwrap();
        assert_eq!(before, after, "a rejected link must not rewrite the file");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn link_in_dir_rejects_a_self_link() {
        let dir = unique_temp_dir("link-self");
        fs::create_dir_all(&dir).unwrap();
        write_ticket(&dir, "TKT-1", &[]);
        assert!(link_in_dir(&dir, "TKT-1", "TKT-1").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unlink_in_dir_removes_the_link_from_disk() {
        let dir = unique_temp_dir("unlink");
        fs::create_dir_all(&dir).unwrap();
        write_ticket(&dir, "TKT-1", &["TKT-2"]);
        write_ticket(&dir, "TKT-2", &[]);

        let updated = unlink_in_dir(&dir, "TKT-1", "TKT-2").unwrap();
        assert!(updated.links.is_empty());
        assert!(build_edges(&load_all_tickets(&dir).unwrap()).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_ticket_preserves_links() {
        // A plain edit goes through `update_ticket`, which must never drop the
        // links that `link_tickets` owns.
        let dir = unique_temp_dir("update-keeps-links");
        fs::create_dir_all(&dir).unwrap();
        write_ticket(&dir, "TKT-1", &["TKT-2"]);
        write_ticket(&dir, "TKT-2", &[]);

        let path = find_ticket_path_by_id(&dir, "TKT-1").unwrap();
        let updated = update_ticket_in(
            &dir,
            "TKT-1.md",
            CreateTicketInput {
                title: "Renamed".to_string(),
                status: None,
                priority: None,
                assignee: None,
                tags: None,
                body: None,
            },
        )
        .unwrap();
        assert_eq!(updated.filename, "TKT-1.md");

        let reread = parse_ticket_file(&path).unwrap();
        assert_eq!(reread.title, "Renamed");
        assert_eq!(reread.links, vec!["TKT-2".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn owned_ticket_paths_accept_ticket_files_at_the_root() {
        assert!(is_owned_ticket_path("TKT-1000-prueba-i.md"));
        assert!(is_owned_ticket_path("TKT-1042-update-csv-parser-for-utf-16.md"));
        assert!(is_owned_ticket_path("TKT-1.md"));
    }

    #[test]
    fn owned_ticket_paths_reject_everything_git_team_does_not_own() {
        for foreign in [
            "AGENTS.md",
            "README.md",
            "architecture.md",
            "BACKLOG.md",
            ".env",
            ".dockerignore",
            "lims-web/package.json",
            "lims-web/src/App.tsx",
            "docs/01-Flujo.md",
            "TKT-1000/notes.md",
            "TKT-1000-prueba-i.txt",
            "TKT-",
            "",
        ] {
            assert!(
                !is_owned_ticket_path(foreign),
                "{} must not be treated as a ticket file",
                foreign
            );
        }
    }

    #[test]
    fn foreign_paths_reports_only_the_offenders() {
        let paths = vec![
            "TKT-1000-a.md".to_string(),
            ".env".to_string(),
            "lims-web/src/App.tsx".to_string(),
            "TKT-1001-b.md".to_string(),
        ];
        assert_eq!(
            foreign_paths(&paths),
            vec![".env".to_string(), "lims-web/src/App.tsx".to_string()]
        );
        assert!(foreign_paths(&["TKT-1001-b.md".to_string()]).is_empty());
        assert!(foreign_paths(&[]).is_empty());
    }

    #[test]
    fn porcelain_parser_finds_worktree_deletions_only() {
        // ` D` is a file missing from the worktree — the signature of a checkout
        // that never finished. `D ` is merely staged, `??` untracked, ` M` edited.
        let output =
            " D lims-web/src/App.tsx\nD  removed.md\n?? new.md\n M edited.md\nA  added.md\n";
        assert_eq!(
            deleted_in_worktree_from_porcelain(output),
            vec!["lims-web/src/App.tsx".to_string()]
        );
        assert!(deleted_in_worktree_from_porcelain("").is_empty());
        assert!(deleted_in_worktree_from_porcelain("?? only-untracked.md\n").is_empty());
    }

    // --- ticket identity ----------------------------------------------------

    fn write_identity_ticket(
        dir: &Path,
        filename: &str,
        id: &str,
        uid: Option<&str>,
        title: &str,
        links: &[&str],
    ) {
        let mut t = sample_ticket(links.iter().map(|s| s.to_string()).collect());
        t.id = id.to_string();
        t.uid = uid.map(|u| u.to_string());
        t.title = title.to_string();
        t.filename = filename.to_string();
        fs::write(dir.join(filename), render_frontmatter(&t)).unwrap();
    }

    #[test]
    fn ulid_is_26_crockford_characters() {
        let id = new_ulid().unwrap();
        assert_eq!(id.len(), 26, "{}", id);
        assert!(
            id.bytes().all(|b| ULID_ALPHABET.contains(&b)),
            "not crockford base32: {}",
            id
        );
    }

    #[test]
    fn ulid_encoding_matches_the_spec_byte_layout() {
        // Independently derived: the same 128-bit big-endian value encoded as 26
        // base32 digits by a different algorithm. These pin the exact
        // bytes-to-characters mapping, the part of the format that can never
        // change afterwards without renumbering every uid in existence.
        let ms: u64 = 0x0198_f2c1_7000;
        let random = [
            0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01, 0x23, 0x45, 0x67,
        ];
        assert_eq!(
            encode_ulid(&ulid_bytes(0, [0x00; 10])),
            "00000000000000000000000000"
        );
        assert_eq!(
            encode_ulid(&ulid_bytes(0xffff_ffff_ffff, [0xff; 10])),
            "7ZZZZZZZZZZZZZZZZZZZZZZZZZ"
        );
        assert_eq!(encode_ulid(&ulid_bytes(ms, random)), "01K3SC2W00NAXWSQFEZW0J6HB7");

        // The timestamp is big-endian in the leading six bytes, so a wrong byte
        // order would still sort correctly among ourselves while making every
        // uid unreadable to anything else. Read it back the long way.
        let bytes = ulid_bytes(ms, random);
        let decoded = bytes[..6]
            .iter()
            .fold(0u64, |acc, b| (acc << 8) | *b as u64);
        assert_eq!(decoded, ms);
    }

    #[test]
    fn ulids_do_not_repeat() {
        let mut seen = std::collections::HashSet::new();
        for _ in 0..10_000 {
            assert!(seen.insert(new_ulid().unwrap()), "duplicate ulid");
        }
    }

    #[test]
    fn ulid_order_matches_creation_order() {
        let older = new_ulid().unwrap();
        std::thread::sleep(Duration::from_millis(3));
        let newer = new_ulid().unwrap();
        assert!(older < newer, "{} should sort before {}", older, newer);
    }

    #[test]
    fn frontmatter_round_trip_preserves_uid() {
        let path = temp_path("uid-round-trip.md");
        let mut original = sample_ticket(vec![]);
        original.uid = Some("01J8QK9W3M4N5P6Q7R8S9T0V1W".to_string());
        fs::write(&path, render_frontmatter(&original)).unwrap();

        let parsed = parse_ticket_file(&path).unwrap();
        assert_eq!(parsed.uid.as_deref(), Some("01J8QK9W3M4N5P6Q7R8S9T0V1W"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn legacy_ticket_without_uid_parses_without_gaining_one() {
        let path = temp_path("legacy-uid.md");
        fs::write(
            &path,
            "---\nid: \"TKT-1041\"\ntitle: \"legacy\"\nstatus: \"backlog\"\nassignee: null\npriority: \"medium\"\ntags: []\nlast_updated: \"2026-01-01T00:00:00Z\"\n---\n\nBody\n",
        )
        .unwrap();

        let parsed = parse_ticket_file(&path).unwrap();
        assert_eq!(parsed.uid, None);
        assert!(
            !render_frontmatter(&parsed).contains("uid:"),
            "rendering invented an identity"
        );
        let _ = fs::remove_file(&path);
    }

    fn create_input(title: &str) -> CreateTicketInput {
        CreateTicketInput {
            title: title.to_string(),
            status: None,
            priority: None,
            assignee: None,
            tags: None,
            body: None,
        }
    }

    #[test]
    fn create_ticket_gives_the_ticket_a_persisted_uid() {
        let dir = unique_temp_dir("create-uid");
        fs::create_dir_all(&dir).unwrap();

        let created = create_ticket_in(&dir, create_input("Identity")).unwrap();

        assert_eq!(created.id, "TKT-1000");
        assert_eq!(created.uid.as_deref().map(str::len), Some(26));
        let on_disk = parse_ticket_file(&dir.join(&created.filename)).unwrap();
        assert_eq!(on_disk.uid, created.uid);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_ticket_keeps_the_uid() {
        let dir = unique_temp_dir("update-keeps-uid");
        fs::create_dir_all(&dir).unwrap();
        write_identity_ticket(
            &dir,
            "TKT-1042.md",
            "TKT-1042",
            Some("01J8QK9W3M4N5P6Q7R8S9T0V1W"),
            "Original",
            &[],
        );

        let updated = update_ticket_in(&dir, "TKT-1042.md", create_input("Edited")).unwrap();

        assert_eq!(updated.uid.as_deref(), Some("01J8QK9W3M4N5P6Q7R8S9T0V1W"));
        let on_disk = parse_ticket_file(&dir.join("TKT-1042.md")).unwrap();
        assert_eq!(on_disk.uid.as_deref(), Some("01J8QK9W3M4N5P6Q7R8S9T0V1W"));
        assert_eq!(on_disk.title, "Edited");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconcile_renumbers_the_newer_ticket_and_rewrites_links() {
        let dir = unique_temp_dir("reconcile-renumber");
        fs::create_dir_all(&dir).unwrap();
        let older = "01J8QK9W3M0000000000000000";
        let newer = "01J8QK9W3MZZZZZZZZZZZZZZZZ";
        // Two people created TKT-1042 offline. The older one keeps the number.
        write_identity_ticket(&dir, "TKT-1042-first.md", "TKT-1042", Some(older), "First", &[]);
        write_identity_ticket(&dir, "TKT-1042-second.md", "TKT-1042", Some(newer), "Second", &[]);
        // A third points at the contested id; a fourth is uninvolved.
        write_identity_ticket(
            &dir,
            "TKT-1041-refs.md",
            "TKT-1041",
            Some("01J8QK9W3M1111111111111111"),
            "Refs",
            &["TKT-1042"],
        );
        write_identity_ticket(
            &dir,
            "TKT-1000-other.md",
            "TKT-1000",
            Some("01J8QK9W3M2222222222222222"),
            "Other",
            &[],
        );

        let renames = reconcile_ticket_ids_in(&dir).unwrap();

        assert_eq!(renames.len(), 1, "{:?}", renames);
        assert_eq!(renames[0].from, "TKT-1042");
        assert_eq!(renames[0].to, "TKT-1043");
        assert_eq!(renames[0].filename, "TKT-1043-second.md");

        // The older ticket keeps both its id and its file.
        let kept = parse_ticket_file(&dir.join("TKT-1042-first.md")).unwrap();
        assert_eq!(kept.id, "TKT-1042");
        assert_eq!(kept.uid.as_deref(), Some(older));

        assert!(
            !dir.join("TKT-1042-second.md").exists(),
            "the superseded file is still on disk"
        );
        let loser = parse_ticket_file(&dir.join("TKT-1043-second.md")).unwrap();
        assert_eq!(loser.id, "TKT-1043");
        assert_eq!(
            loser.uid.as_deref(),
            Some(newer),
            "identity must survive renumbering"
        );

        // The reference follows the ticket it pointed at.
        let referrer = parse_ticket_file(&dir.join("TKT-1041-refs.md")).unwrap();
        assert_eq!(referrer.links, vec!["TKT-1043".to_string()]);

        // Nothing unrelated was rewritten.
        let other = parse_ticket_file(&dir.join("TKT-1000-other.md")).unwrap();
        assert_eq!(other.uid.as_deref(), Some("01J8QK9W3M2222222222222222"));
        assert!(other.links.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconcile_leaves_a_unique_id_set_alone() {
        let dir = unique_temp_dir("reconcile-noop");
        fs::create_dir_all(&dir).unwrap();
        write_identity_ticket(
            &dir,
            "TKT-1000-a.md",
            "TKT-1000",
            Some("01J8QK9W3M1111111111111111"),
            "A",
            &[],
        );
        write_identity_ticket(
            &dir,
            "TKT-1001-b.md",
            "TKT-1001",
            Some("01J8QK9W3M2222222222222222"),
            "B",
            &[],
        );

        assert!(reconcile_ticket_ids_in(&dir).unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconcile_lets_a_legacy_ticket_keep_a_contested_id() {
        // A file with no uid predates the identity scheme, so it is the older of
        // the two and keeps the number.
        let dir = unique_temp_dir("reconcile-legacy");
        fs::create_dir_all(&dir).unwrap();
        write_identity_ticket(&dir, "TKT-1042-legacy.md", "TKT-1042", None, "Legacy", &[]);
        write_identity_ticket(
            &dir,
            "TKT-1042-new.md",
            "TKT-1042",
            Some("01J8QK9W3M1111111111111111"),
            "New",
            &[],
        );

        let renames = reconcile_ticket_ids_in(&dir).unwrap();

        assert_eq!(renames.len(), 1, "{:?}", renames);
        assert_eq!(renames[0].to, "TKT-1043");
        let kept = parse_ticket_file(&dir.join("TKT-1042-legacy.md")).unwrap();
        assert_eq!(kept.uid, None);
        let _ = fs::remove_dir_all(&dir);
    }

    fn git_in(dir: &Path, args: &[&str]) {
        let out = git_out(dir, args);
        assert!(
            out.status.success(),
            "git {:?} failed in {}: {}{}",
            args,
            dir.display(),
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[test]
    fn two_clones_that_created_the_same_id_converge_after_a_real_merge() {
        // The end-to-end case this whole scheme exists for, driven through real
        // git: a bare repository the test owns (so it is genuinely offline), two
        // clones, and one ticket created in each while they cannot see each
        // other. Both land on TKT-1000.
        let root = unique_temp_dir("two-clones");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let remote = root.join("remote.git");
        git_in(&root, &["init", "--bare", "-q", remote.to_str().unwrap()]);

        let seed = root.join("seed");
        git_in(&root, &["clone", "-q", remote.to_str().unwrap(), seed.to_str().unwrap()]);
        fs::write(seed.join("README.md"), "board\n").unwrap();
        git_in(&seed, &["add", "README.md"]);
        git_in(&seed, &["commit", "-q", "-m", "init"]);
        git_in(&seed, &["push", "-q", "origin", "HEAD"]);

        let alice = root.join("alice");
        let bob = root.join("bob");
        for who in [&alice, &bob] {
            git_in(&root, &["clone", "-q", remote.to_str().unwrap(), who.to_str().unwrap()]);
        }

        // Alice goes first so her uid is the older one.
        let alice_ticket = create_ticket_in(&alice, create_input("Shared board")).unwrap();
        assert_eq!(alice_ticket.id, "TKT-1000");
        git_in(&alice, &["add", "-A"]);
        git_in(&alice, &["commit", "-q", "-m", "alice ticket"]);
        git_in(&alice, &["push", "-q"]);

        // Bob was working offline: same id, different ticket, and his own
        // second ticket already points at it.
        let bob_ticket = create_ticket_in(&bob, create_input("Bob's ticket")).unwrap();
        assert_eq!(bob_ticket.id, "TKT-1000", "the collision must be reproduced");
        let bob_second = create_ticket_in(&bob, create_input("Bob's follow-up")).unwrap();
        assert_eq!(bob_second.id, "TKT-1001");
        link_in_dir(&bob, "TKT-1001", "TKT-1000").unwrap();
        git_in(&bob, &["add", "-A"]);
        git_in(&bob, &["commit", "-q", "-m", "bob tickets"]);

        // Different filenames, so the merge itself is clean and git reports no
        // conflict: the two files simply coexist, both claiming TKT-1000.
        git_in(&bob, &["pull", "-q", "--rebase", "--autostash"]);
        let after_merge = load_all_tickets(&bob).unwrap();
        assert_eq!(
            after_merge.iter().filter(|t| t.id == "TKT-1000").count(),
            2,
            "the merge should leave two tickets claiming TKT-1000"
        );

        // Alice's ticket is older, so she keeps the id.
        let renames = reconcile_ticket_ids_in(&bob).unwrap();
        assert_eq!(renames.len(), 1, "{:?}", renames);
        assert_eq!(renames[0].from, "TKT-1000");
        assert_eq!(renames[0].to, "TKT-1002");

        let bob_dir_id = load_all_tickets(&bob)
            .unwrap()
            .iter()
            .find(|t| t.uid == bob_ticket.uid)
            .map(|t| t.id.clone())
            .unwrap();
        assert_eq!(bob_dir_id, "TKT-1002", "Bob's ticket was the one renumbered");
        let referrer = parse_ticket_file(&find_ticket_path_by_id(&bob, "TKT-1001").unwrap()).unwrap();
        assert_eq!(
            referrer.links,
            vec!["TKT-1002".to_string()],
            "Bob's own reference followed his ticket"
        );

        // The repair propagates, and the other clone agrees without having to
        // change anything of its own.
        git_in(&bob, &["add", "-A"]);
        git_in(&bob, &["commit", "-q", "-m", "repair colliding ids"]);
        git_in(&bob, &["push", "-q"]);
        git_in(&alice, &["pull", "-q", "--rebase", "--autostash"]);

        assert!(
            reconcile_ticket_ids_in(&alice).unwrap().is_empty(),
            "Alice must not renumber anything after her pull"
        );
        let alice_view = load_all_tickets(&alice).unwrap();
        assert_eq!(alice_view.len(), 3);
        assert_eq!(
            alice_view.iter().filter(|t| t.id == "TKT-1000").count(),
            1,
            "exactly one ticket owns TKT-1000 once both clones converged"
        );
        // Alice's ticket is untouched and still hers.
        let alice_now = alice_view.iter().find(|t| t.uid == alice_ticket.uid).unwrap();
        assert_eq!(alice_now.id, "TKT-1000");
        assert_eq!(alice_now.filepath, alice_ticket.filepath);

        let _ = fs::remove_dir_all(&root);
    }

    // --- merge driver -------------------------------------------------------

    /// A git subprocess whose failure the caller inspects itself.
    fn git_out(dir: &Path, args: &[&str]) -> std::process::Output {
        std::process::Command::new("git")
            .args(["-c", "user.name=GitTeam Test"])
            .args(["-c", "user.email=test@example.com"])
            .args(["-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git could not be started")
    }

    fn driver_version(
        status: &str,
        tags: &[&str],
        links: &[&str],
        last_updated: &str,
        body: &str,
    ) -> Ticket {
        let mut t = sample_ticket(links.iter().map(|s| s.to_string()).collect());
        t.status = status.to_string();
        t.tags = tags.iter().map(|s| s.to_string()).collect();
        t.last_updated = last_updated.to_string();
        t.body = body.to_string();
        t
    }

    /// Write a ticket the way git hands it to the driver: a temp file with no
    /// extension of its own, which is why the driver cannot rely on the name.
    fn driver_file(
        dir: &Path,
        name: &str,
        id: &str,
        uid: &str,
        status: &str,
        title: &str,
        body: &str,
    ) -> PathBuf {
        let mut t = sample_ticket(vec![]);
        t.id = id.to_string();
        t.uid = Some(uid.to_string());
        t.status = status.to_string();
        t.title = title.to_string();
        t.body = body.to_string();
        let path = dir.join(name);
        fs::write(&path, render_frontmatter(&t)).unwrap();
        path
    }

    fn driver_args(base: &Path, ours: &Path, theirs: &Path) -> Vec<String> {
        vec![
            base.to_string_lossy().to_string(),
            ours.to_string_lossy().to_string(),
            theirs.to_string_lossy().to_string(),
        ]
    }

    #[test]
    fn merge_driver_command_quotes_the_binary_and_uses_forward_slashes() {
        assert_eq!(
            merge_driver_command(Path::new("/opt/git team/gitteam")),
            "\"/opt/git team/gitteam\" merge-driver %O %A %B",
            "a path with a space has to reach git quoted"
        );
        assert_eq!(
            merge_driver_command(Path::new("C:\\Program Files\\gitteam.exe")),
            "\"C:/Program Files/gitteam.exe\" merge-driver %O %A %B",
            "a backslash would be an escape character in git's shell"
        );
    }

    #[test]
    fn merge_keeps_each_sides_own_change() {
        let base = driver_version("backlog", &["ui"], &[], "2026-01-01T00:00:00Z", "Body");
        let mut ours = base.clone();
        ours.status = "in-progress".to_string();
        ours.last_updated = "2026-01-02T00:00:00Z".to_string();
        let mut theirs = base.clone();
        theirs.title = "Renamed by them".to_string();
        theirs.tags = vec!["ui".to_string(), "urgent".to_string()];
        theirs.last_updated = "2026-01-03T00:00:00Z".to_string();

        let merged = merge_ticket_versions_of(Some(&base), &ours, &theirs);

        assert_eq!(merged.status, "in-progress", "our change survives");
        assert_eq!(merged.title, "Renamed by them", "their change survives");
        assert_eq!(
            merged.tags,
            vec!["ui".to_string(), "urgent".to_string()],
            "the tag they added survives and the one they left alone is not doubled"
        );
        assert_eq!(
            merged.last_updated, "2026-01-03T00:00:00Z",
            "the merged ticket carries the newest edit"
        );
    }

    #[test]
    fn merge_lets_the_newer_edit_win_when_both_changed_the_same_field() {
        let base = driver_version("backlog", &[], &[], "2026-01-01T00:00:00Z", "Body");
        let mut ours = base.clone();
        ours.status = "review".to_string();
        ours.last_updated = "2026-01-05T00:00:00Z".to_string();
        let mut theirs = base.clone();
        theirs.status = "done".to_string();
        theirs.last_updated = "2026-01-04T00:00:00Z".to_string();

        let merged = merge_ticket_versions_of(Some(&base), &ours, &theirs);

        assert_eq!(merged.status, "review", "the later edit is the survivor");
    }

    #[test]
    fn merge_keeps_both_bodies_both_links_and_the_older_identity() {
        let mut base = driver_version(
            "backlog",
            &[],
            &["TKT-1"],
            "2026-01-01T00:00:00Z",
            "Opening",
        );
        base.uid = Some("01J8QK9W3M1111111111111111".to_string());
        let mut ours = base.clone();
        ours.body = "Opening\nour paragraph".to_string();
        ours.links = vec!["TKT-1".to_string(), "TKT-7".to_string()];
        ours.uid = Some("01J8QK9W3MZZZZZZZZZZZZZZZZ".to_string());
        let mut theirs = base.clone();
        theirs.body = "Opening\ntheir paragraph".to_string();
        theirs.links = vec!["TKT-1".to_string(), "TKT-9".to_string()];
        theirs.uid = Some("01J8QK9W3M0000000000000000".to_string());

        let merged = merge_ticket_versions_of(Some(&base), &ours, &theirs);

        assert!(
            merged.body.contains("our paragraph") && merged.body.contains("their paragraph"),
            "both texts have to survive: {:?}",
            merged.body
        );
        assert_eq!(
            merged.links,
            vec![
                "TKT-1".to_string(),
                "TKT-7".to_string(),
                "TKT-9".to_string()
            ],
            "no reference is dropped when both sides added one"
        );
        assert_eq!(
            merged.uid.as_deref(),
            Some("01J8QK9W3M0000000000000000"),
            "the older identity wins"
        );
    }

    #[test]
    fn merge_writes_a_shared_opening_once_and_keeps_the_shared_tail() {
        let base = driver_version(
            "backlog",
            &[],
            &[],
            "2026-01-01T00:00:00Z",
            "Opening\nTrailer",
        );
        let mut ours = base.clone();
        ours.body = "Opening\nour paragraph\nTrailer".to_string();
        let mut theirs = base.clone();
        theirs.body = "Opening\ntheir paragraph\nTrailer".to_string();

        let merged = merge_ticket_versions_of(Some(&base), &ours, &theirs);

        assert_eq!(
            merged.body.matches("Opening").count(),
            1,
            "lines both sides kept are written once: {:?}",
            merged.body
        );
        assert_eq!(
            merged.body.matches("Trailer").count(),
            1,
            "a shared tail is not repeated either: {:?}",
            merged.body
        );
        assert!(
            merged.body.contains("our paragraph") && merged.body.contains("their paragraph"),
            "{:?}",
            merged.body
        );
    }

    #[test]
    fn merge_honours_a_body_one_side_removed() {
        let base = driver_version("backlog", &[], &[], "2026-01-01T00:00:00Z", "Old text");
        let mut ours = base.clone();
        ours.body = String::new();
        ours.last_updated = "2026-01-02T00:00:00Z".to_string();

        let merged = merge_ticket_versions_of(Some(&base), &ours, &base);

        assert_eq!(
            merged.body, "",
            "clearing the body is a change, not a reason to restore the old text"
        );
    }

    #[test]
    fn merge_keeps_a_body_whose_own_text_contains_a_rule() {
        let base = driver_version("backlog", &[], &[], "2026-01-01T00:00:00Z", "Opening");
        let mut ours = base.clone();
        ours.body = "Opening\n\n---\n\nour half".to_string();
        let mut theirs = base.clone();
        theirs.body = "Opening\ntheir half".to_string();

        let merged = merge_ticket_versions_of(Some(&base), &ours, &theirs);
        let dir = unique_temp_dir("merge-body-rule");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("TKT-1.md");
        fs::write(&path, render_frontmatter(&merged)).unwrap();

        let reparsed = parse_ticket_file(&path).unwrap();

        assert!(
            reparsed.body.contains("our half") && reparsed.body.contains("their half"),
            "a horizontal rule inside a body must not break the file: {:?}",
            reparsed.body
        );
        assert_eq!(reparsed.id, merged.id);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_driver_writes_the_result_and_refuses_what_it_cannot_parse() {
        let dir = unique_temp_dir("merge-driver-cli");
        fs::create_dir_all(&dir).unwrap();
        let base = driver_file(
            &dir,
            ".merge_file_base",
            "TKT-1",
            "01J8QK9W3M1111111111111111",
            "backlog",
            "Title",
            "Body",
        );
        let ours = driver_file(
            &dir,
            ".merge_file_ours",
            "TKT-1",
            "01J8QK9W3M1111111111111111",
            "in-progress",
            "Title",
            "our line",
        );
        let theirs = driver_file(
            &dir,
            ".merge_file_theirs",
            "TKT-1",
            "01J8QK9W3M1111111111111111",
            "in-progress",
            "Title",
            "their line",
        );

        assert_eq!(
            merge_driver_main(&driver_args(&base, &ours, &theirs)),
            0,
            "git's own temp names have to be accepted"
        );
        let merged = parse_ticket_file(&ours).unwrap();
        assert_eq!(merged.status, "in-progress");
        assert!(
            merged.body.contains("our line") && merged.body.contains("their line"),
            "{:?}",
            merged.body
        );

        // A side that is not a ticket: refuse, and leave what git handed us
        // exactly as it was, so its own conflict stays clean.
        let junk = dir.join(".merge_file_junk");
        fs::write(&junk, "not a ticket at all").unwrap();
        assert_ne!(
            merge_driver_main(&driver_args(&base, &junk, &theirs)),
            0,
            "an unparseable side must not be merged"
        );
        assert_eq!(fs::read_to_string(&junk).unwrap(), "not a ticket at all");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_driver_handles_an_add_add_with_an_empty_base() {
        let dir = unique_temp_dir("merge-driver-addadd");
        fs::create_dir_all(&dir).unwrap();
        // For a merge with no ancestor git hands over an empty file.
        let base = dir.join(".merge_file_base");
        fs::write(&base, "").unwrap();
        let ours = driver_file(
            &dir,
            ".merge_file_ours",
            "TKT-1000",
            "01J8QK9W3MZZZZZZZZZZZZZZZZ",
            "backlog",
            "Mine",
            "my body",
        );
        let theirs = driver_file(
            &dir,
            ".merge_file_theirs",
            "TKT-1000",
            "01J8QK9W3M0000000000000000",
            "done",
            "Theirs",
            "their body",
        );

        assert_eq!(
            merge_driver_main(&driver_args(&base, &ours, &theirs)),
            0,
            "an empty base is a merge without history, not a failure"
        );

        let merged = parse_ticket_file(&ours).unwrap();
        assert_eq!(merged.id, "TKT-1000", "one ticket comes out, not two");
        assert!(
            merged.body.contains("my body") && merged.body.contains("their body"),
            "{:?}",
            merged.body
        );
        assert_eq!(
            merged.uid.as_deref(),
            Some("01J8QK9W3M0000000000000000"),
            "the older identity wins"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn registering_the_driver_is_idempotent_and_keeps_existing_rules() {
        let dir = unique_temp_dir("driver-register");
        fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q", "."]);
        fs::write(dir.join(".git/info/attributes"), "*.png binary\n").unwrap();

        let command = "gitteam merge-driver %O %A %B";
        assert!(
            ensure_merge_driver_with(&dir, command).await.unwrap(),
            "the first run configures the clone"
        );
        assert!(
            !ensure_merge_driver_with(&dir, command).await.unwrap(),
            "the second run changes nothing"
        );

        let attributes = fs::read_to_string(dir.join(".git/info/attributes")).unwrap();
        assert!(
            attributes.contains("*.png binary"),
            "rules the user already had survive: {}",
            attributes
        );
        assert_eq!(
            attributes
                .lines()
                .filter(|line| line.trim() == "TKT-*.md merge=gitteam-ticket")
                .count(),
            1,
            "exactly one rule, no duplicates: {}",
            attributes
        );

        let configured = git_out(&dir, &["config", "--get", "merge.gitteam-ticket.driver"]);
        assert_eq!(
            String::from_utf8_lossy(&configured.stdout).trim(),
            command
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_git_uses_the_registered_driver_and_merges_without_a_conflict() {
        use std::os::unix::fs::PermissionsExt;

        let root = unique_temp_dir("driver-e2e");
        fs::create_dir_all(&root).unwrap();
        git_in(&root, &["init", "-q", "."]);

        let ticket = driver_file(
            &root,
            "TKT-1.md",
            "TKT-1",
            "01J8QK9W3M1111111111111111",
            "backlog",
            "Title",
            "Body",
        );
        git_in(&root, &["add", "-A"]);
        git_in(&root, &["commit", "-q", "-m", "base"]);

        // Only once the commit exists: on an unborn HEAD `rev-parse
        // --abbrev-ref` answers "HEAD" instead of a branch name, and checking
        // that out would silently stay where we already were.
        let branch = String::from_utf8_lossy(
            &git_out(&root, &["rev-parse", "--abbrev-ref", "HEAD"]).stdout,
        )
        .trim()
        .to_string();

        // A stand-in driver: a test must never point git at the test binary,
        // which would re-run the whole suite from inside a merge.
        let script = root.join("driver.sh");
        fs::write(
            &script,
            "#!/bin/sh\n{ cat \"$2\"; echo \"driver-ran\"; } > \"$2\"\n",
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let command = format!("{} %O %A %B", script.display());
        ensure_merge_driver_with(&root, &command).await.unwrap();

        git_in(&root, &["checkout", "-q", "-b", "other"]);
        fs::write(&ticket, "theirs\n").unwrap();
        git_in(&root, &["commit", "-qam", "theirs"]);
        git_in(&root, &["checkout", "-q", &branch]);
        fs::write(&ticket, "ours\n").unwrap();
        git_in(&root, &["commit", "-qam", "ours"]);

        let merge = git_out(&root, &["merge", "-m", "merge other", "other"]);
        assert!(
            merge.status.success(),
            "with the driver registered this merge must not conflict: {}{}",
            String::from_utf8_lossy(&merge.stdout),
            String::from_utf8_lossy(&merge.stderr)
        );
        let merged_file = fs::read_to_string(&ticket).unwrap();
        assert!(
            merged_file.contains("driver-ran"),
            "git has to run the registered driver, not its own merge; file={:?}",
            merged_file
        );
        assert!(
            git_out(&root, &["diff", "--name-only", "--diff-filter=U"])
                .stdout
                .is_empty(),
            "no unmerged path may be left behind"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_credential_override_skips_remotes_that_carry_no_credential() {
        // A local board is supported, and a plain path is how this very suite
        // talks to its remotes: rewriting one would turn it into a broken url.
        assert!(credentialed_remote_override("/tmp/board.git", "tok").is_empty());
        assert!(credentialed_remote_override("file:///tmp/board.git", "tok").is_empty());
        assert!(credentialed_remote_override("ssh://git@github.com/a/b.git", "tok").is_empty());
    }

    #[test]
    fn the_credential_override_matches_the_clean_url_and_never_the_token() {
        let clean = "https://github.com/astivens/board.git";
        let args = credentialed_remote_override(clean, "tok");
        assert_eq!(args[0], "-c");
        let rest = args[1]
            .strip_prefix("url.")
            .expect("the override must be a url.* config");
        let (target, matched) = rest
            .split_once(".insteadOf=")
            .expect("the override must be an insteadOf rule");
        // git substitutes `target` for `matched`: the credential is what reaches
        // the network, and the credential-free url is what gets replaced.
        assert!(target.contains("tok@"), "target: {}", target);
        assert_eq!(matched, clean);
    }

    #[test]
    fn git_reads_the_stored_remote_through_the_credential_override() {
        // The mechanism this fix rests on: the stored remote stays clean and a
        // single command reaches the credentialed url without writing anything.
        // Real git, no network.
        let dir = unique_temp_dir("cred-override");
        fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q"]);
        let clean = "https://github.com/astivens/board.git";
        git_in(&dir, &["remote", "add", "origin", clean]);

        let plain = git_out(&dir, &["remote", "get-url", "origin"]);
        assert_eq!(
            String::from_utf8_lossy(&plain.stdout).trim(),
            clean,
            "the stored url must stay credential-free"
        );

        let override_args = credentialed_remote_override(clean, "tok");
        let mut args: Vec<&str> = override_args.iter().map(|s| s.as_str()).collect();
        args.extend_from_slice(&["remote", "get-url", "origin"]);
        let credentialed = git_out(&dir, &args);
        let out = String::from_utf8_lossy(&credentialed.stdout);
        assert!(
            out.contains("tok@"),
            "with the override git must resolve the credentialed url, got: {}",
            out
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_credential_left_in_the_stored_remote_url_is_removed() {
        let dir = unique_temp_dir("cred-repair");
        fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q"]);
        git_in(
            &dir,
            &[
                "remote",
                "add",
                "origin",
                "https://x-access-token:secret@github.com/astivens/board.git",
            ],
        );

        assert!(
            strip_stored_userinfo(&dir),
            "a stored credential must be reported as rewritten"
        );
        let repaired = git_out(&dir, &["remote", "get-url", "origin"]);
        assert_eq!(
            String::from_utf8_lossy(&repaired.stdout).trim(),
            "https://github.com/astivens/board.git"
        );
        assert!(
            !strip_stored_userinfo(&dir),
            "a clean remote must be left untouched"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    // S1 — real git: the clone argument reaches `.git/config`, never the
    // substitution target, and the one-command rule is not persisted.
    fn a_clone_through_the_override_stores_no_credential() {
        let root = unique_temp_dir("clone-override");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let remote = root.join("remote.git");
        git_in(&root, &["init", "--bare", "-q", remote.to_str().unwrap()]);
        let seed = root.join("seed");
        git_in(
            &root,
            &["clone", "-q", remote.to_str().unwrap(), seed.to_str().unwrap()],
        );
        fs::write(seed.join("README.md"), "board\n").unwrap();
        git_in(&seed, &["add", "README.md"]);
        git_in(&seed, &["commit", "-q", "-m", "init"]);
        git_in(&seed, &["push", "-q", "origin", "HEAD"]);

        let clean = "https://github.com/astivens/board.git";
        for (name, redirect) in [
            ("path", format!("url.{}.insteadOf={}", remote.display(), clean)),
            (
                "userinfo",
                format!("url.file://x:tok@{}.insteadOf={}", remote.display(), clean),
            ),
        ] {
            let dst = root.join(name);
            git_in(
                &root,
                &["-c", &redirect, "clone", "-q", clean, dst.to_str().unwrap()],
            );
            let stored = git_out(&dst, &["remote", "get-url", "origin"]);
            assert_eq!(
                String::from_utf8_lossy(&stored.stdout).trim(),
                clean,
                "{}",
                name
            );
            let config = fs::read_to_string(dst.join(".git/config")).unwrap();
            assert!(
                !config.contains("insteadOf"),
                "the rule must not be persisted: {}",
                config
            );
            assert!(
                !config.contains("tok"),
                "{} leaked a credential: {}",
                name,
                config
            );
        }

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    // S6 — a message never hands the token back. The shapes are the ones git,
    // curl and the credential override actually produce.
    fn redact_credentials_takes_the_credential_out_of_the_shapes_it_travels_in() {
        let cases = [
            (
                "the password form github uses",
                "fatal: unable to access 'https://x-access-token:ghp_secret@github.com/a/b.git/': The requested URL returned error: 403",
                "fatal: unable to access 'https://***@github.com/a/b.git/': The requested URL returned error: 403",
            ),
            (
                "the token-as-user form any other host gets",
                "fatal: could not read from 'https://ghp_secret@gitea.example.com/a/b.git/'",
                "fatal: could not read from 'https://***@gitea.example.com/a/b.git/'",
            ),
            (
                "the override key run_git_with_credential prepends",
                "-c url.https://x-access-token:ghp_secret@github.com/.insteadOf=https://github.com/ clone --no-progress",
                "-c url.https://***@github.com/.insteadOf=https://github.com/ clone --no-progress",
            ),
            (
                "a url that carries nothing, path included",
                "git fetch failed (exit 128): fatal: could not read Username for 'https://github.com/a/b.git'",
                "git fetch failed (exit 128): fatal: could not read Username for 'https://github.com/a/b.git'",
            ),
            (
                "an ssh url, where git@ is addressing and not a secret",
                "fatal: could not read from 'ssh://git@github.com/a/b.git'",
                "fatal: could not read from 'ssh://git@github.com/a/b.git'",
            ),
        ];
        for (name, input, expected) in cases {
            assert_eq!(redact_credentials(input), expected, "{}", name);
        }
    }

    #[tokio::test]
    // S6 — the whole path, not just the string: the credential belongs to the
    // arguments `run_git_with_credential` builds, so a failure there reached the
    // user with the token in it.
    async fn a_failed_command_does_not_report_the_credential_it_was_given() {
        let dir = unique_temp_dir("credential-in-error");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // `rev-parse` fails in a directory that is not a repository, with no
        // network and no project involved: the credential is in argv and the
        // command still fails deterministically.
        let err = run_git_with_credential(
            &dir,
            "https://github.com/astivens/board.git",
            "ghp_secret",
            &["rev-parse", "HEAD"],
            10,
            None,
        )
        .await
        .expect_err("a directory that is not a repository must fail");
        assert!(
            !err.contains("ghp_secret"),
            "the token came back to the caller: {}",
            err
        );
        assert!(
            err.contains("***@github.com"),
            "the arguments are still reported, redacted: {}",
            err
        );
        assert!(
            err.contains("fatal:"),
            "and so is what git said: {}",
            err
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    // S6 — the property on the connect form's own path: git anonymises the
    // userinfo of the url it prints, and this keeps it that way whichever way the
    // probe fails. It passes without the redactor too — that is the finding, and
    // it is recorded in the log: the reproducible leak was our own arguments,
    // which the test above pins. Port 1 on loopback refuses at once, so this needs
    // neither DNS nor an outside network.
    async fn the_connection_test_does_not_report_the_credential_it_was_given() {
        let result = git_test_connection_inner("https://127.0.0.1:1/board.git", "ghp_secret")
            .await
            .expect("this probe reports failures in its result, it does not return Err");
        let error = result.error.expect("port 1 refuses the connection");
        assert!(!result.ok, "the probe must be reported as failed");
        assert!(
            !error.contains("ghp_secret"),
            "the token came back to the connect form: {}",
            error
        );
    }

    #[test]
    // S6 — the credential lives in the keyring, so it does not go into the file
    // either: a url pasted with its token in it is stored without one.
    fn a_credential_in_the_configured_url_is_not_written_to_the_config() {
        let config = GitConfig {
            repo_url: "https://x-access-token:ghp_secret@github.com/astivens/board.git".to_string(),
            git_user_name: "Ada".to_string(),
            git_user_email: "ada@example.com".to_string(),
            last_sync_at: Some("2026-10-19T00:00:00Z".to_string()),
        };

        let stored = config_to_persist(&config);
        assert_eq!(
            stored.repo_url, "https://github.com/astivens/board.git",
            "the url is stored clean"
        );
        assert_eq!(stored.git_user_name, "Ada");
        assert_eq!(stored.git_user_email, "ada@example.com");
        assert_eq!(stored.last_sync_at.as_deref(), Some("2026-10-19T00:00:00Z"));

        let json = serde_json::to_string_pretty(&stored).unwrap();
        assert!(
            !json.contains("ghp_secret"),
            "the file would carry the token: {}",
            json
        );

        let clean = GitConfig {
            repo_url: "https://github.com/astivens/board.git".to_string(),
            ..config.clone()
        };
        assert_eq!(
            config_to_persist(&clean).repo_url,
            "https://github.com/astivens/board.git",
            "a url that never carried a credential is written as it came"
        );
    }

    #[test]
    // S6 — an uppercase scheme used to be left in place, so the credentialed url
    // came out double-wrapped and the token sat behind the `/` that closes the
    // authority the redactor scans. It is normalised before the token goes in.
    fn a_url_pasted_with_an_uppercase_scheme_is_not_double_wrapped() {
        let authenticated = with_authenticated_url("HTTPS://github.com/astivens/board.git", "ghp_s");
        assert_eq!(
            authenticated, "https://x-access-token:ghp_s@github.com/astivens/board.git",
            "one scheme, and the host is the one that was pasted"
        );
        assert_eq!(
            authenticated.matches("https://").count(),
            1,
            "the url is not wrapped twice: {}",
            authenticated
        );
        assert_eq!(
            strip_userinfo(&authenticated),
            "https://github.com/astivens/board.git",
            "and what gets stored carries no credential"
        );
    }

    #[test]
    // S6 — the redaction applied to a command's stderr is defence in depth, and
    // this pins the measurement it rests on: git strips the userinfo before it
    // prints a url, so on every shape it produces the redactor is an identity.
    // Offline: port 1 refuses the connection at once.
    fn git_anonymises_the_url_it_prints_so_the_redactor_is_a_no_op_on_it() {
        for url in [
            "https://x-access-token:ghp_s@127.0.0.1:1/board.git",
            "https://ghp_s@127.0.0.1:1/board.git",
        ] {
            let out = std::process::Command::new("git")
                .args(["ls-remote", url, "HEAD"])
                .output()
                .expect("git could not be started");
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            assert!(!out.status.success(), "the probe must fail: {}", stderr);
            assert!(
                !stderr.contains("ghp_s"),
                "git printed the credential: {}",
                stderr
            );
            assert_eq!(
                redact_credentials(&stderr),
                stderr,
                "nothing left for the redactor to do"
            );
        }
    }

    #[test]
    // S3 — the repair is a no-op for remotes that carry no credential in their
    // userinfo, and for an SSH url where `git@host` is addressing, not a secret.
    fn strip_stored_userinfo_leaves_non_http_remotes_alone() {
        for (name, url) in [
            ("path", "/tmp/plain-board.git"),
            ("file", "file:///tmp/plain-board.git"),
            ("ssh", "ssh://git@github.com/a/b.git"),
        ] {
            let dir = unique_temp_dir(&format!("keep-{}", name));
            fs::create_dir_all(&dir).unwrap();
            git_in(&dir, &["init", "-q"]);
            git_in(&dir, &["remote", "add", "origin", url]);
            assert!(!strip_stored_userinfo(&dir), "{} must not be rewritten", url);
            let after = git_out(&dir, &["remote", "get-url", "origin"]);
            assert_eq!(String::from_utf8_lossy(&after.stdout).trim(), url);
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    // S4 — a sync must never fail because there is nothing to repair.
    fn strip_stored_userinfo_is_a_noop_without_an_origin() {
        let dir = unique_temp_dir("cred-no-origin");
        fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q"]);
        assert!(!strip_stored_userinfo(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    // S5 — only the commands that talk to the remote pay for a credential.
    fn only_the_network_commands_pay_for_a_credential() {
        for a in ["fetch", "pull", "push", "ls-remote", "clone"] {
            assert!(needs_credential(&[a]), "{}", a);
        }
        for a in [
            "status",
            "log",
            "merge",
            "config",
            "checkout",
            "add",
            "diff",
            "show",
            "rebase",
            "reset",
            "rev-parse",
            "remote",
        ] {
            assert!(!needs_credential(&[a]), "{}", a);
        }
    }

    #[test]
    // S2 — the injected rule reaches the remote for fetch and push (real git,
    // offline: a local bare repository stands in for the network).
    fn the_override_reaches_the_remote_for_fetch_and_push() {
        let root = unique_temp_dir("override-network");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let remote = root.join("remote.git");
        git_in(&root, &["init", "--bare", "-q", remote.to_str().unwrap()]);
        let seed = root.join("seed");
        git_in(
            &root,
            &["clone", "-q", remote.to_str().unwrap(), seed.to_str().unwrap()],
        );
        fs::write(seed.join("README.md"), "board\n").unwrap();
        git_in(&seed, &["add", "README.md"]);
        git_in(&seed, &["commit", "-q", "-m", "init"]);
        git_in(&seed, &["push", "-q", "origin", "HEAD"]);

        let clean = "https://github.com/astivens/board.git";
        let redirect = format!("url.{}.insteadOf={}", remote.display(), clean);
        let work = root.join("work");
        git_in(
            &root,
            &["-c", &redirect, "clone", "-q", clean, work.to_str().unwrap()],
        );
        git_in(&work, &["-c", &redirect, "fetch", "-q", "origin"]);
        fs::write(work.join("TKT-1000-a.md"), "---\nid: TKT-1000\n---\n\nx\n").unwrap();
        git_in(&work, &["add", "-A"]);
        git_in(&work, &["commit", "-q", "-m", "ticket"]);
        git_in(&work, &["-c", &redirect, "push", "-q", "origin", "HEAD"]);

        let pushed = git_out(&remote, &["rev-parse", "HEAD"]);
        let local = git_out(&work, &["rev-parse", "HEAD"]);
        assert_eq!(
            String::from_utf8_lossy(&pushed.stdout),
            String::from_utf8_lossy(&local.stdout),
            "the push must have reached the remote through the override"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn sanitize_board_name_folds_what_a_repository_name_cannot_hold() {
        assert_eq!(sanitize_board_name("Royero Labs"), "royero-labs");
        assert_eq!(sanitize_board_name("  board!!  "), "board");
        assert_eq!(sanitize_board_name("a/b"), "a-b");
        assert_eq!(sanitize_board_name("keep_this.one"), "keep_this.one");
        assert_eq!(sanitize_board_name("-already-"), "already");
        assert_eq!(sanitize_board_name("a   b"), "a-b");
        assert_eq!(sanitize_board_name("!!!"), "board");
        assert_eq!(sanitize_board_name(""), "board");
    }

    #[test]
    fn default_board_name_prefers_the_project_it_belongs_to() {
        assert_eq!(default_board_name(Some("royero-labs")), "royero-labs-board");
        assert_eq!(default_board_name(Some("Royero Labs")), "royero-labs-board");
        assert_eq!(default_board_name(Some("   ")), "gitteam-board");
        assert_eq!(default_board_name(None), "gitteam-board");
    }

    #[test]
    fn board_name_candidates_offer_numbered_fallbacks() {
        assert_eq!(
            board_name_candidates("royero-board", 3),
            vec!["royero-board", "royero-board-2", "royero-board-3"]
        );
        assert_eq!(board_name_candidates("b", 1), vec!["b"]);
    }

    #[test]
    fn a_taken_name_is_the_only_retryable_create_failure() {
        assert!(github_name_taken(
            422,
            r#"{"message":"Repository creation failed.","errors":[{"message":"name already exists on this account"}]}"#
        ));
        assert!(!github_name_taken(422, r#"{"message":"Validation Failed"}"#));
        assert!(!github_name_taken(
            403,
            r#"{"message":"name already exists on this account"}"#
        ));
    }

    #[test]
    fn a_token_without_the_repo_scope_says_so_instead_of_a_bare_403() {
        // GitHub answers 403 (or a deliberately vague 404) when the scope is
        // missing, and never says which scope: the header is the only source.
        let missing = github_api_error(403, Some("public_repo, workflow"), "{}");
        assert!(missing.contains("`repo`"), "{}", missing);
        assert!(missing.contains("public_repo, workflow"), "{}", missing);

        let hidden = github_api_error(404, Some(""), "{}");
        assert!(hidden.contains("`repo`"), "{}", hidden);
        assert!(hidden.contains("none"), "{}", hidden);

        // A 401 is about the token itself, not about a scope.
        let invalid = github_api_error(401, None, "{}");
        assert!(invalid.contains("expired"), "{}", invalid);

        // Scope present: the 403 is a plain permission problem.
        let refused = github_api_error(403, Some("repo, workflow"), "{}");
        assert!(!refused.contains("missing"), "{}", refused);
        assert!(refused.contains("permissions"), "{}", refused);
    }

    #[test]
    fn a_github_error_prefers_the_specific_message() {
        let body = r#"{"message":"Validation Failed","errors":[{"message":"name already exists on this account"}]}"#;
        let message = github_api_error(422, Some("repo"), body);
        assert!(
            message.contains("name already exists on this account"),
            "{}",
            message
        );

        // A body that is not JSON must not derail the message.
        let raw = github_api_error(500, None, "  boom\n\n");
        assert!(raw.contains("500") && raw.contains("boom"), "{}", raw);

        // Nor one that is empty.
        let empty = github_api_error(500, None, "");
        assert!(empty.contains("500"), "{}", empty);
    }

    #[test]
    fn the_board_credential_comes_from_the_form_or_the_saved_project() {
        assert_eq!(
            choose_board_pat(Some("  typed  ".to_string()), Some("saved".to_string())).unwrap(),
            "typed"
        );
        assert_eq!(
            choose_board_pat(None, Some("saved".to_string())).unwrap(),
            "saved"
        );
        assert_eq!(
            choose_board_pat(Some("   ".to_string()), Some("saved".to_string())).unwrap(),
            "saved"
        );
        assert!(choose_board_pat(None, None).is_err());
    }

    #[test]
    fn the_board_git_identity_comes_from_the_form_or_the_saved_project() {
        let config = GitConfig {
            repo_url: "https://github.com/a/b.git".to_string(),
            git_user_name: "Saved Name".to_string(),
            git_user_email: "saved@example.com".to_string(),
            last_sync_at: None,
        };
        assert_eq!(
            choose_git_identity(None, None, Some(&config)).unwrap(),
            ("Saved Name".to_string(), "saved@example.com".to_string())
        );
        assert_eq!(
            choose_git_identity(
                Some("Typed".to_string()),
                Some("typed@example.com".to_string()),
                Some(&config)
            )
            .unwrap(),
            ("Typed".to_string(), "typed@example.com".to_string())
        );
        assert!(choose_git_identity(None, None, None).is_err());
    }

    #[test]
    fn a_board_is_created_private_and_with_an_initial_commit() {
        let body = board_create_body("royero-labs-board");
        assert_eq!(body["name"], "royero-labs-board");
        assert_eq!(
            body["private"], true,
            "a board is private unless the user decides otherwise"
        );
        assert_eq!(
            body["auto_init"], true,
            "an empty repository has no branch for the clone to check out"
        );
    }

    #[test]
    fn a_missing_scope_header_is_still_reported_as_a_missing_repo_scope() {
        // The header is absent for fine-grained tokens, so its absence must
        // still lead with the scope problem instead of a bare 403.
        let absent = github_api_error(403, None, "{}");
        assert!(absent.contains("`repo`"), "{}", absent);
        assert!(absent.contains("none"), "{}", absent);

        // With the scope present there is no scope story to tell.
        let present = github_api_error(404, Some("repo"), "{}");
        assert!(!present.contains("missing"), "{}", present);
    }

    #[test]
    fn the_repo_scope_is_an_exact_list_member() {
        // A scope that merely contains "repo" is not the scope.
        for value in ["repo", "repo,workflow", "workflow, repo ", "public_repo,repo"] {
            let message = github_api_error(403, Some(value), "{}");
            assert!(message.contains("permissions"), "{:?} -> {}", value, message);
        }
        for value in ["repo_deployment", "public_repo", "repo:status"] {
            let message = github_api_error(403, Some(value), "{}");
            assert!(message.contains("missing"), "{:?} -> {}", value, message);
        }
    }

    #[test]
    fn the_candidate_list_always_offers_the_base_name() {
        assert_eq!(board_name_candidates("b", 0), vec!["b"]);
        assert_eq!(board_name_candidates("b", 2).len(), 2);
    }

    #[test]
    fn an_invitation_link_round_trips_through_its_own_parser() {
        let link = build_invite_link(
            "https://github.com/astivens/royero-labs-board.git",
            "royero-labs-board",
            "Ana Dev",
        );
        assert_eq!(
            link,
            "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fastivens%2Froyero-labs-board.git&board=royero-labs-board&from=Ana%20Dev"
        );

        let parsed = parse_invite_link(&link).expect("the link we build must parse");
        assert_eq!(
            parsed.repo_url,
            "https://github.com/astivens/royero-labs-board.git"
        );
        assert_eq!(parsed.board.as_deref(), Some("royero-labs-board"));
        assert_eq!(parsed.from.as_deref(), Some("Ana Dev"));
    }

    #[test]
    fn a_pasted_link_tolerates_whitespace_and_missing_labels() {
        // The same string is copied as text, so it arrives with whatever the
        // messenger added around it, and an older link may carry no labels.
        let parsed = parse_invite_link(
            "  gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git  ",
        )
        .expect("a link carrying only a repository must parse");
        assert_eq!(parsed.repo_url, "https://github.com/a/b.git");
        assert_eq!(parsed.board, None);
        assert_eq!(parsed.from, None);
    }

    #[test]
    fn a_link_that_is_not_an_invitation_is_rejected_with_a_reason() {
        for text in [
            "",
            "   ",
            "https://github.com/a/b.git",
            "gitteam://other?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git",
            "gitteam://join",
            "gitteam://join?",
            "gitteam://join&repo=x",
            "gitteam://join?repo",
            "gitteam://join?board=only-a-label",
        ] {
            let error = parse_invite_link(text).expect_err("must be rejected");
            assert!(!error.trim().is_empty(), "{:?} produced no reason", text);
        }
    }

    #[test]
    fn a_parameter_a_newer_app_sends_is_ignored_rather_than_fatal() {
        let parsed = parse_invite_link(
            "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git&scope=board%2Fread",
        )
        .expect("an unknown parameter must not break the parse");
        assert_eq!(parsed.repo_url, "https://github.com/a/b.git");
    }

    #[test]
    fn an_invitation_never_carries_a_credential_in_either_direction() {
        // Writing: a stored remote that somehow kept its token must not leak it
        // into a string the user is about to pass around.
        let link = build_invite_link("https://ghp_secret@github.com/a/b.git", "b", "Ana");
        assert!(!link.contains("ghp_secret"), "{}", link);
        assert!(link.contains("github.com%2Fa%2Fb.git"), "{}", link);

        // Reading: a hand-edited link must not hand a credential to the clone.
        let parsed = parse_invite_link(
            "gitteam://join?repo=https%3A%2F%2Fghp_secret%40github.com%2Fa%2Fb.git",
        )
        .expect("the link is well formed");
        assert_eq!(parsed.repo_url, "https://github.com/a/b.git");
    }

    #[test]
    fn a_password_is_stripped_in_any_scheme_but_a_user_name_is_not() {
        // `ssh://git@host` is an address; `ssh://user:secret@host` carries one.
        assert_eq!(
            invite_repo_url("ssh://user:ghp_secret@github.com/a/b.git"),
            "ssh://github.com/a/b.git"
        );
        assert_eq!(
            invite_repo_url("ssh://git@github.com/a/b.git"),
            "ssh://git@github.com/a/b.git"
        );
    }

    #[test]
    fn an_ssh_remote_survives_the_link_untouched() {
        // In an ssh address, `git@host` is the address, not a credential.
        let link = build_invite_link("git@github.com:a/b.git", "b", "Ana");
        let parsed = parse_invite_link(&link).expect("an ssh board is a board too");
        assert_eq!(parsed.repo_url, "git@github.com:a/b.git");
    }

    #[test]
    fn percent_encoding_survives_every_character_a_label_can_meet() {
        // The format is a query, not form encoding: `+` is a plus, and a label
        // with spaces, an accent, an ampersand and a percent must come back
        // exactly as it went in.
        let board = "Tablero ñ & + 100%";
        let link = build_invite_link("https://github.com/a/b.git", board, "José");
        let parsed = parse_invite_link(&link).expect("the built link must parse");
        assert_eq!(parsed.board.as_deref(), Some(board));
        assert_eq!(parsed.from.as_deref(), Some("José"));
        assert!(
            !link.contains("Tablero ñ"),
            "a raw space would cut the link short: {}",
            link
        );

        // The round trip alone cannot catch form decoding, because building
        // always escapes `+` as %2B and a parser that turned `+` into a space
        // would still pass it. A hand-written link is what pins the difference.
        let hand = parse_invite_link(
            "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git&board=a+b&from=x+y",
        )
        .expect("the link is well formed");
        assert_eq!(hand.board.as_deref(), Some("a+b"));
        assert_eq!(hand.from.as_deref(), Some("x+y"));

        // Padding is trimmed on purpose: a label is shown to a person, and a
        // link that travelled through a messenger arrives with whitespace.
        let padded = parse_invite_link(
            "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git&board=%20%20pad%20%20",
        )
        .expect("the link is well formed");
        assert_eq!(padded.board.as_deref(), Some("pad"));
    }

    #[test]
    fn a_broken_escape_is_reported_rather_than_guessed() {
        for bad in ["%zz", "%", "%4", "%e2", "%e2%28%a1", "%FF%FE"] {
            let link = format!("gitteam://join?repo={}", bad);
            assert!(parse_invite_link(&link).is_err(), "accepted {:?}", bad);
        }
    }

    // ----- T6: el link abre la app, y lo que llega puede no ser una invitación -----

    #[test]
    fn a_received_link_is_an_invitation_when_it_reads_as_one() {
        let url =
            "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git&board=b&from=Ana";
        let intake = classify_received_links(&[url.to_string()]);
        assert_eq!(intake.invite.as_deref(), Some(url));
        assert_eq!(intake.not_an_invitation, None);
    }

    #[test]
    fn a_gitteam_link_that_is_not_an_invitation_is_reported_rather_than_ignored() {
        // El esquema es nuestro, así que lo que llegue por ahí no es
        // necesariamente una invitación. Decirlo es la diferencia entre no hacer
        // nada y no hacer nada *sin explicar por qué*.
        for other in [
            "gitteam://other?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git",
            "gitteam://join",
            "gitteam://join?board=only-a-label",
            "https://github.com/a/b.git",
        ] {
            let intake = classify_received_links(&[other.to_string()]);
            assert_eq!(intake.invite, None, "accepted {:?}", other);
            assert_eq!(
                intake.not_an_invitation.as_deref(),
                Some(other),
                "did not report {:?}",
                other
            );
        }
    }

    #[test]
    fn no_link_arrives_as_nothing_rather_than_as_an_error() {
        // Arrancar la app sin link es el caso normal: no hay nada que avisar.
        assert_eq!(classify_received_links(&[]), LinkIntake::default());
        assert_eq!(
            classify_received_links(&["".to_string(), "   ".to_string()]),
            LinkIntake::default()
        );
    }

    #[test]
    fn the_invitation_wins_over_the_other_links_around_it() {
        let link = "  gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git  ";
        let intake = classify_received_links(&[
            "gitteam://other".to_string(),
            link.to_string(),
            "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fc%2Fd.git".to_string(),
        ]);
        // Recortado, porque un link que pasó por un mensajero llega con espacios.
        assert_eq!(
            intake.invite.as_deref(),
            Some("gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git")
        );
        // Con una invitación en mano no hay nada que reprocharle a los demás.
        assert_eq!(intake.not_an_invitation, None);
    }

    // Las cuatro de abajo las escribió la verificación independiente de T6 como
    // sondas sobre el código de arriba, y se adoptaron tal cual: cubren el mismo
    // contrato desde el otro lado (orden, repetidos, huecos entre links, y un
    // escape roto que no se puede aceptar como invitación).

    #[test]
    fn received_links_first_invitation_wins_in_any_order() {
        let a = "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git";
        let b = "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fc%2Fd.git";
        let intake = classify_received_links(&[b.to_string(), a.to_string()]);
        assert_eq!(intake.invite.as_deref(), Some(b));
        assert_eq!(intake.not_an_invitation, None);

        // El mismo link dos veces no cambia nada.
        let again = classify_received_links(&[a.to_string(), a.to_string()]);
        assert_eq!(again.invite.as_deref(), Some(a));
        assert_eq!(again.not_an_invitation, None);
    }

    #[test]
    fn received_links_blank_entries_are_skipped_between_links() {
        let a = "gitteam://join?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb.git";
        let intake = classify_received_links(&["  ".to_string(), a.to_string(), String::new()]);
        assert_eq!(intake.invite.as_deref(), Some(a));
        assert_eq!(intake.not_an_invitation, None);
    }

    #[test]
    fn received_links_report_only_the_first_non_invitation() {
        let intake =
            classify_received_links(&["gitteam://x".to_string(), "gitteam://y".to_string()]);
        assert_eq!(intake.invite, None);
        assert_eq!(intake.not_an_invitation.as_deref(), Some("gitteam://x"));
    }

    #[test]
    fn received_links_broken_escape_is_reported_not_accepted() {
        // Un link que no se puede leer entero no es una invitación a medias: se
        // informa, igual que en el pegado a mano.
        let bad = "gitteam://join?repo=%zz&board=b";
        let intake = classify_received_links(&[bad.to_string()]);
        assert_eq!(intake.invite, None);
        assert_eq!(intake.not_an_invitation.as_deref(), Some(bad));
    }

    // ----- T5: el dueño otorga el acceso por @usuario -----

    #[test]
    fn a_github_username_is_normalized_the_way_github_writes_it() {
        assert_eq!(
            normalize_github_username("  @Ana-Dev  ").unwrap(),
            "Ana-Dev"
        );
        assert_eq!(normalize_github_username("ana").unwrap(), "ana");
        // El límite de GitHub, de los dos lados.
        assert_eq!(
            normalize_github_username(&"a".repeat(39)).unwrap().len(),
            39
        );

        for bad in [
            "",
            "   ",
            "@",
            "@@",
            "ana dev",
            "-ana",
            "ana-",
            "ana--dev",
            "a--b",
            "ana/dev",
            "ana#dev",
            "ana_dev",
            "ana.",
            "ana,",
            "ana@dev",
            "@ana@dev",
            "áná",
        ] {
            let error = normalize_github_username(bad).expect_err("must be rejected");
            assert!(!error.trim().is_empty(), "{:?} produced no reason", bad);
        }

        let too_long = "a".repeat(40);
        assert!(normalize_github_username(&too_long).is_err());
    }

    #[test]
    fn a_repository_is_named_by_its_owner_and_its_name() {
        assert_eq!(
            repo_full_name("https://github.com/astivens/royero-labs-board.git").as_deref(),
            Some("astivens/royero-labs-board")
        );
        assert_eq!(
            repo_full_name("git@github.com:astivens/board.git").as_deref(),
            Some("astivens/board")
        );
        assert_eq!(
            repo_full_name("https://ghp_secret@github.com/astivens/board").as_deref(),
            Some("astivens/board")
        );
        assert_eq!(
            repo_full_name("https://user:pass@github.com/astivens/board").as_deref(),
            Some("astivens/board")
        );
        assert_eq!(
            repo_full_name("ssh://git@github.com:2222/astivens/board.git").as_deref(),
            Some("astivens/board")
        );
        // Un query pegado de más no es parte del nombre del repositorio.
        assert_eq!(
            repo_full_name("https://github.com/astivens/board.git?x=1").as_deref(),
            Some("astivens/board")
        );

        // Otorgar acceso por usuario es una operación de GitHub: en otro host no
        // hay nada que preguntar, y decirlo acá es mejor que fallar más tarde.
        assert_eq!(repo_full_name("https://gitlab.com/astivens/board.git"), None);
        assert_eq!(repo_full_name("https://github.com.other/astivens/board"), None);
        // El host se lee después del último `@`: si no, una url se hace pasar
        // por GitHub.
        assert_eq!(
            repo_full_name("https://github.com@evil.com/astivens/board"),
            None
        );
        assert_eq!(repo_full_name("file:///home/anuar/boards/mine"), None);
        assert_eq!(repo_full_name("https://github.com/astivens"), None);
        assert_eq!(repo_full_name("/home/anuar/boards/mine"), None);
    }

    #[test]
    fn the_collaborator_call_asks_for_write_access() {
        // Como el cuerpo de la creación del board: lo que el cambio promete
        // vive en un test, no sólo en un literal dentro de la llamada.
        assert_eq!(
            collaborator_invite_body(),
            serde_json::json!({ "permission": "push" })
        );
    }

    #[test]
    fn a_new_invitation_and_an_existing_collaborator_read_differently() {
        let invited = collaborator_result_message(201, "Ana-Dev");
        assert!(invited.contains("Ana-Dev"), "{}", invited);
        assert!(invited.to_lowercase().contains("accept"), "{}", invited);

        let already = collaborator_result_message(204, "Ana-Dev");
        assert!(already.contains("Ana-Dev"), "{}", already);
        assert_ne!(invited, already);
    }

    #[test]
    fn a_username_github_does_not_know_says_so() {
        let message = collaborator_error_message(404, None, "{}", "ana");
        assert!(message.contains("ana"), "{}", message);

        // El mapeo general explica un 403 hablando de **crear un repositorio**,
        // que no es lo que hace esta llamada: el alta de acceso tiene su propio
        // motivo para ser rechazada y lo dice.
        let forbidden = collaborator_error_message(403, None, r#"{"message":"Forbidden"}"#, "ana");
        assert!(forbidden.contains("ana"), "{}", forbidden);
        assert!(forbidden.contains("access"), "{}", forbidden);
        assert!(
            !forbidden.contains("creating a repository"),
            "{}",
            forbidden
        );

        // Lo que no tiene un caso propio sigue usando el mapeo general, que lee
        // el cuerpo.
        let validation =
            collaborator_error_message(422, None, r#"{"message":"Validation Failed"}"#, "ana");
        assert!(validation.contains("Validation Failed"), "{}", validation);
    }

    #[test]
    fn a_403_with_the_repo_scope_does_not_claim_the_scope_is_missing() {
        // El header puede decir que el scope está: entonces no se puede afirmar
        // que falte. Lo que reporta el token es lo que separa "le falta el
        // scope" de "esta cuenta no administra el repositorio".
        let body = r#"{"message":"Forbidden"}"#;
        let message = collaborator_error_message(403, Some("repo"), body, "ana");
        assert!(message.contains("ana"), "{}", message);
        assert!(!message.contains("missing the `repo` scope"), "{}", message);
        assert!(!message.contains("creating a repository"), "{}", message);
    }

    #[test]
    fn a_403_from_a_token_that_does_not_report_repo_still_names_the_missing_scope() {
        // La otra mitad de la misma decisión: cuando el token reporta scopes y
        // el `repo` no está entre ellos, el motivo sí es el scope que falta. Sin
        // este test, esa rama se podía cambiar por la otra sin que nada cayera
        // (lo encontró el recheck por mutación).
        let body = r#"{"message":"Forbidden"}"#;
        for scopes in [
            Some("public_repo"),
            Some("workflow"),
            Some("repo_deployment"),
        ] {
            let message = collaborator_error_message(403, scopes, body, "ana");
            assert!(message.contains("ana"), "{:?} -> {}", scopes, message);
            assert!(
                message.contains("missing the `repo` scope"),
                "{:?} -> {}",
                scopes,
                message
            );
            assert!(message.contains("access"), "{:?} -> {}", scopes, message);
        }
    }

    #[test]
    fn a_403_from_granting_access_never_reads_as_repository_creation() {
        let body = r#"{"message":"Forbidden"}"#;
        for scopes in [
            None,
            Some(""),
            Some("   "),
            Some("repo"),
            Some("repo, workflow"),
            Some("public_repo"),
        ] {
            let message = collaborator_error_message(403, scopes, body, "ana");
            assert!(
                !message.contains("creating a repository"),
                "{:?} -> {}",
                scopes,
                message
            );
            assert!(message.contains("access"), "{}", message);
        }
    }

    #[test]
    fn a_status_without_a_case_of_its_own_still_uses_the_general_mapping() {
        let body = r#"{"message":"Forbidden"}"#;
        for status in [400u16, 401, 409, 422, 429, 500] {
            assert_eq!(
                collaborator_error_message(status, None, body, "ana"),
                github_api_error(status, None, body)
            );
        }
    }

    // ----- T5: el invitado acepta la invitación que GitHub dejó pendiente -----

    const PENDING_INVITATIONS: &str = r#"[
      {
        "id": 424242,
        "repository": { "full_name": "astivens/royero-labs-board", "private": true },
        "inviter": { "login": "astivens" },
        "permissions": "write",
        "expired": false
      },
      {
        "id": 7,
        "repository": { "full_name": "otra/board" },
        "inviter": null,
        "permissions": "read"
      }
    ]"#;

    #[test]
    fn pending_invitations_are_read_from_what_github_sends() {
        let invites = pending_invitations_from_json(PENDING_INVITATIONS).expect("must parse");
        assert_eq!(invites.len(), 2);
        assert_eq!(invites[0].id, 424242);
        assert_eq!(invites[0].repo, "astivens/royero-labs-board");
        assert_eq!(invites[0].from.as_deref(), Some("astivens"));
        assert_eq!(invites[1].from, None);
    }

    #[test]
    fn an_empty_or_unreadable_list_of_invitations_is_handled() {
        assert!(pending_invitations_from_json("[]")
            .expect("an empty list is not a failure")
            .is_empty());
        assert!(pending_invitations_from_json("not json").is_err());
        assert!(pending_invitations_from_json("{}").is_err());

        // Una invitación a la que le falta el repositorio o el identificador no
        // se convierte en algo a medias: se informa.
        for half in [
            r#"[{"id":1}]"#,
            r#"[{"id":1,"repository":null}]"#,
            r#"[{"repository":{"full_name":"a/b"}}]"#,
            r#"[{"id":"7","repository":{"full_name":"a/b"}}]"#,
        ] {
            assert!(
                pending_invitations_from_json(half).is_err(),
                "accepted {:?}",
                half
            );
        }

        // Quién la manda es opcional: no poder decirlo no invalida la invitación.
        let invites =
            pending_invitations_from_json(r#"[{"id":1,"repository":{"full_name":"a/b"}}]"#)
                .expect("must parse");
        assert_eq!(invites[0].from, None);
    }

    #[test]
    fn the_invitation_offered_is_the_one_for_this_board() {
        let invites = pending_invitations_from_json(PENDING_INVITATIONS).expect("must parse");
        // GitHub no distingue mayúsculas en los nombres.
        let found =
            invitation_for_repo(&invites, "Astivens/Royero-Labs-Board").expect("must match");
        assert_eq!(found.id, 424242);
        assert_eq!(invitation_for_repo(&invites, "astivens/otra-cosa"), None);
    }

    #[test]
    fn every_github_call_carries_the_same_headers() {
        // Los headers se movieron a un solo lugar para que las tres llamadas de
        // T5 no repitan cuatro líneas cada una; esto fija que siguen siendo los
        // mismos que usaba la creación del board.
        let headers = github_headers("ghp_secret");
        let names: Vec<&str> = headers.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            names,
            vec![
                "Authorization",
                "Accept",
                "X-GitHub-Api-Version",
                "User-Agent"
            ]
        );
        assert_eq!(headers[0].1, "Bearer ghp_secret");
        assert_eq!(headers[3].1, "gitteam");

        // La credencial viaja en un header y en ninguno más.
        assert_eq!(
            headers
                .iter()
                .filter(|(_, value)| value.contains("ghp_secret"))
                .count(),
            1
        );
    }
}
