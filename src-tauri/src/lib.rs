use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use gray_matter::engine::YAML;
use gray_matter::{Matter, Pod};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct Ticket {
    pub id: String,
    pub title: String,
    pub status: String,
    pub assignee: Option<String>,
    pub priority: String,
    pub tags: Vec<String>,
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

fn data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "could not resolve $HOME".to_string())?;
    Ok(home.join(".gitteam-data").join("tickets"))
}

fn ensure_data_dir() -> Result<PathBuf, String> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all failed: {}", e))?;
    Ok(dir)
}

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

fn render_frontmatter(t: &Ticket) -> String {
    let assignee_line = match &t.assignee {
        Some(a) => format!("assignee: {}\n", yaml_quote(a)),
        None => "assignee: null\n".to_string(),
    };
    let tags_line = format!("tags: {}\n", yaml_flow_seq(&t.tags));
    format!(
        "---\nid: {id}\ntitle: {title}\nstatus: {status}\n{assignee}priority: {priority}\n{tags}last_updated: {last_updated}\n---\n\n{body}",
        id = yaml_quote(&t.id),
        title = yaml_quote(&t.title),
        status = yaml_quote(&t.status),
        assignee = assignee_line,
        priority = yaml_quote(&t.priority),
        tags = tags_line,
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

    let id = get_str("id")?;
    let title = get_str("title")?;
    let status = get_str("status")?;
    let priority = get_str("priority")?;
    let last_updated = get_str("last_updated")?;
    let assignee = get_opt_str("assignee")?;
    let tags = get_tags()?;

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
                    if p.extension().and_then(|s| s.to_str()) == Some("md") {
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

#[tauri::command]
fn init_data_dir() -> Result<String, String> {
    let dir = ensure_data_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn list_tickets() -> Result<Vec<Ticket>, String> {
    let dir = ensure_data_dir()?;
    let entries = fs::read_dir(&dir).map_err(|e| format!("read_dir failed: {}", e))?;
    let mut tickets = vec![];
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        match parse_ticket_file(&path) {
            Ok(t) => tickets.push(t),
            Err(e) => eprintln!(
                "[gitteam] skipping malformed ticket {}: {}",
                path.display(),
                e
            ),
        }
    }
    sort_tickets_desc(&mut tickets);
    Ok(tickets)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            init_data_dir,
            list_tickets,
            read_ticket_raw,
            create_ticket,
            update_ticket,
            delete_ticket,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}