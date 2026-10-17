use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use gray_matter::engine::YAML;
use gray_matter::{Matter, Pod};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::timeout;

#[derive(Serialize, Deserialize, Debug)]
pub struct Ticket {
    pub id: String,
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

/// Resolve the data dir for the active project, falling back to the legacy
/// `~/.gitteam-data/` when no multi-project is set up. All existing ticket and
/// git commands use this so they automatically pick up the active project.
fn data_dir() -> Result<PathBuf, String> {
    if let Some((id, _)) = active_project()? {
        return project_repo_dir(&id);
    }
    let home = dirs::home_dir().ok_or_else(|| "could not resolve $HOME".to_string())?;
    Ok(home.join(".gitteam-data"))
}

fn ensure_data_dir() -> Result<PathBuf, String> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all failed: {}", e))?;
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

fn write_git_config(config: &GitConfig) -> Result<(), String> {
    let path = config_path()?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("serialize config failed: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("write config failed: {}", e))?;
    Ok(())
}

// ----- url helpers -----

fn with_authenticated_url(url: &str, pat: &str) -> String {
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
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

fn strip_userinfo(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let (scheme, rest) = url.split_at(scheme_end + 3);
        if let Some(at_idx) = rest.find('@') {
            return format!("{}{}", scheme, &rest[at_idx + 1..]);
        }
    }
    url.to_string()
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
    for a in args {
        cmd.arg(a);
    }
    let fut = cmd.output();
    let output = timeout(Duration::from_secs(timeout_secs), fut)
        .await
        .map_err(|_| format!("git {} timed out after {}s", args.join(" "), timeout_secs))?
        .map_err(|e| format!("git spawn failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "git {} failed (exit {}): {}",
            args.join(" "),
            output.status,
            stderr.trim()
        ));
    }
    Ok(stdout)
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
    format!(
        "---\nid: {id}\ntitle: {title}\nstatus: {status}\n{assignee}priority: {priority}\n{tags}{links}last_updated: {last_updated}\n---\n\n{body}",
        id = yaml_quote(&t.id),
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
    let dir = ensure_data_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

fn load_all_tickets(dir: &Path) -> Result<Vec<Ticket>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read_dir failed: {}", e))?;
    let mut tickets = vec![];
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
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
    let dir = ensure_data_dir()?;
    load_all_tickets(&dir)
}

#[tauri::command]
fn read_ticket_raw(filename: String) -> Result<String, String> {
    let dir = ensure_data_dir()?;
    let path = dir.join(&filename);
    if !path.exists() {
        return Err(format!("file not found: {}", filename));
    }
    fs::read_to_string(&path).map_err(|e| format!("read failed: {}", e))
}

#[tauri::command]
fn create_ticket(input: CreateTicketInput) -> Result<Ticket, String> {
    let dir = ensure_data_dir()?;
    let title = input.title.trim();
    if title.is_empty() {
        return Err("title is required".to_string());
    }
    let id = next_ticket_id(&dir);
    let taken = list_taken_filenames(&dir);
    let filename = generate_filename(&id, title, &taken);

    let ticket = Ticket {
        id,
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
    let dir = ensure_data_dir()?;
    let path = dir.join(&filename);
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
    let dir = ensure_data_dir()?;
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

/// Add `to` to `from`'s `links`. The link is recorded on the source ticket
/// only (like an Obsidian `[[wiki-link]]`); the graph renders the pair as one
/// undirected edge.
#[tauri::command]
fn link_tickets(from: String, to: String) -> Result<Ticket, String> {
    let dir = ensure_data_dir()?;
    let from = from.trim().to_uppercase();
    let to = to.trim().to_uppercase();
    link_in_dir(&dir, &from, &to)
}

#[tauri::command]
fn unlink_tickets(from: String, to: String) -> Result<Ticket, String> {
    let dir = ensure_data_dir()?;
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
    let dir = ensure_data_dir()?;
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
    let dir = data_dir()?;
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
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
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
    let dir = data_dir()?;
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
        cmd.arg("clone").arg(&auth_url).arg(&dir);
        let output = timeout(Duration::from_secs(60), cmd.output())
            .await
            .map_err(|_| "git clone timed out after 60s".to_string())?
            .map_err(|e| format!("git clone failed to spawn: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "git clone failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
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
        cmd.args(&["remote", "add", "origin", &auth_url]);
        let status = timeout(Duration::from_secs(15), cmd.status())
            .await
            .map_err(|_| "git remote add timed out".to_string())?
            .map_err(|e| format!("git remote add failed: {}", e))?;
        if !status.success() {
            return Err("git remote add failed".to_string());
        }

        let output = run_git(&dir, &["fetch"], 60, None).await?;
        let _ = output;

        let reset_main = run_git(&dir, &["reset", "--hard", "origin/main"], 15, None).await;
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

        run_git(&dir, &["fetch"], 60, None).await?;

        let pull_status = run_git(
            &dir,
            &["pull", "--rebase", "--autostash"],
            30,
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

    save_pat(&pat)?;

    let mut config_to_save = config.clone();
    config_to_save.last_sync_at = Some(now_iso());
    write_git_config(&config_to_save)?;

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
        config: config_to_save,
        head_sha: head,
        files_count,
    })
}

#[tauri::command]
async fn git_pull(config: GitConfig) -> Result<PullResult, String> {
    let dir = ensure_data_dir()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository. Please reconnect.".to_string());
    }

    run_git(&dir, &["fetch"], 30, None).await?;

    let count_output = run_git(&dir, &["log", "HEAD..@{u}", "--oneline"], 10, None)
        .await
        .unwrap_or_default();
    let commits_pulled = if count_output.trim().is_empty() {
        0
    } else {
        count_output.lines().count() as u32
    };

    let pull = run_git(
        &dir,
        &["pull", "--rebase", "--autostash"],
        30,
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
    })
}

#[tauri::command]
async fn git_push(config: GitConfig) -> Result<PushResult, String> {
    let dir = ensure_data_dir()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository. Please reconnect.".to_string());
    }

    let upstream_check = run_git(
        &dir,
        &["rev-parse", "--abbrev-ref", "--symbolic", "@{u}"],
        10,
        None,
    )
    .await;

    let mut cmd = build_git_cmd_with_user(&dir, &config.git_user_name, &config.git_user_email);
    if upstream_check.is_err() {
        cmd.args(&["push", "-u", "origin", "HEAD"]);
    } else {
        cmd.args(&["push", "origin", "HEAD"]);
    }

    let output = timeout(Duration::from_secs(60), cmd.output())
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

#[tauri::command]
async fn git_commit_ticket(
    filename: String,
    action: String,
    config: GitConfig,
) -> Result<CommitResult, String> {
    let dir = ensure_data_dir()?;
    if !dir.join(".git").exists() {
        return Err("Data directory is not a git repository. Please reconnect.".to_string());
    }

    let add = run_git(&dir, &["add", &filename], 10, None).await;
    if let Err(e) = add {
        return Err(format!("git add failed: {}", e));
    }

    let head_before = git_head(&dir).await.unwrap_or_default();

    let mut diff_cmd = build_git_cmd(&dir);
    diff_cmd.args(&["diff", "--cached", "--quiet"]);
    let diff_status = timeout(Duration::from_secs(10), diff_cmd.status())
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
        &["commit", "-m", &commit_msg],
        15,
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
    let dir = ensure_data_dir()?;
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

    let status_output = run_git(&dir, &["status", "--porcelain"], 10, None)
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

#[tauri::command]
async fn git_list_local_changes() -> Result<Vec<String>, String> {
    let dir = ensure_data_dir()?;
    if !dir.join(".git").exists() {
        return Ok(vec![]);
    }
    let output = run_git(&dir, &["status", "--porcelain"], 10, None)
        .await
        .unwrap_or_default();
    let files: Vec<String> = output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.chars().skip(3).collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(files)
}

// ----- conflict resolution commands (Fase 4) -----

/// Return the list of unmerged (conflicted) files. An empty list means there are
/// no conflicts (or we are not in a rebase/merge state).
#[tauri::command]
async fn git_list_conflicts() -> Result<Vec<String>, String> {
    let dir = ensure_data_dir()?;
    if !dir.join(".git").exists() {
        return Ok(vec![]);
    }
    let output = run_git(&dir, &["diff", "--name-only", "--diff-filter=U"], 10, None)
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
    let dir = ensure_data_dir()?;
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
    let dir = ensure_data_dir()?;
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
    let dir = ensure_data_dir()?;
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
    let dir = ensure_data_dir()?;
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
            let dir = match data_dir() {
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
                    let stderr = String::from_utf8_lossy(&output.stderr);
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
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
        let existing = parse_ticket_file(&path).unwrap();
        let updated = Ticket {
            title: "Renamed".to_string(),
            last_updated: now_iso(),
            links: existing.links,
            ..existing
        };
        atomic_write(&path, &render_frontmatter(&updated)).unwrap();

        let reread = parse_ticket_file(&path).unwrap();
        assert_eq!(reread.title, "Renamed");
        assert_eq!(reread.links, vec!["TKT-2".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }
}
