//! The merge driver is a second entry point of the same binary.
//!
//! Nothing inside the library can prove that `main` routes `merge-driver` there
//! without opening a window, so this runs the real executable the way git does:
//! as a child process, with three file paths and an exit code for an answer.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn work_dir(name: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("gitteam-cli-{}-{}", std::process::id(), name));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).unwrap();
    p
}

/// The minimal frontmatter the app accepts, written by hand because the
/// renderer is private to the library.
fn ticket(id: &str, uid: &str, status: &str, body: &str) -> String {
    format!(
        "---\nid: {}\nuid: {}\ntitle: Title\nstatus: {}\npriority: medium\nlast_updated: 2026-01-01T00:00:00Z\n---\n\n{}\n",
        id, uid, status, body
    )
}

fn run_driver(args: &[String]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_gitteam"))
        .arg("merge-driver")
        .args(args)
        .output()
        .expect("the gitteam binary could not be started")
}

fn paths(base: &Path, ours: &Path, theirs: &Path) -> Vec<String> {
    vec![
        base.to_string_lossy().to_string(),
        ours.to_string_lossy().to_string(),
        theirs.to_string_lossy().to_string(),
    ]
}

#[test]
fn the_binary_merges_a_conflicting_ticket_and_leaves_a_parseable_file() {
    let dir = work_dir("merge");
    let base = dir.join(".merge_file_base");
    let ours = dir.join(".merge_file_ours");
    let theirs = dir.join(".merge_file_theirs");
    let uid = "01J8QK9W3M1111111111111111";
    fs::write(&base, ticket("TKT-1", uid, "backlog", "Body")).unwrap();
    fs::write(&ours, ticket("TKT-1", uid, "in-progress", "our line")).unwrap();
    fs::write(&theirs, ticket("TKT-1", uid, "in-progress", "their line")).unwrap();

    let args = paths(&base, &ours, &theirs);
    let out = run_driver(&args);

    assert!(
        out.status.success(),
        "the driver must answer a clean merge with exit 0: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    let merged = fs::read_to_string(&ours).unwrap();
    assert!(
        merged
            .lines()
            .any(|line| line.starts_with("status:") && line.contains("in-progress")),
        "{}",
        merged
    );
    assert!(
        merged.contains("our line") && merged.contains("their line"),
        "both sides have to survive: {}",
        merged
    );
    assert_eq!(
        merged
            .lines()
            .filter(|line| line.starts_with("id:"))
            .count(),
        1,
        "a duplicated key is what corrupts the file: {}",
        merged
    );
    assert!(
        merged.starts_with("---\n") && merged.contains("\n---\n"),
        "the result has to stay a ticket: {}",
        merged
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_binary_refuses_what_it_cannot_merge_and_says_so() {
    let dir = work_dir("refuse");
    let base = dir.join(".merge_file_base");
    let junk = dir.join(".merge_file_junk");
    let theirs = dir.join(".merge_file_theirs");
    let uid = "01J8QK9W3M1111111111111111";
    fs::write(&base, ticket("TKT-1", uid, "backlog", "Body")).unwrap();
    fs::write(&junk, "not a ticket at all").unwrap();
    fs::write(&theirs, ticket("TKT-1", uid, "done", "theirs")).unwrap();

    let args = paths(&base, &junk, &theirs);
    let out = run_driver(&args);

    assert!(
        !out.status.success(),
        "an unparseable side must not be reported as merged"
    );
    assert_eq!(
        fs::read_to_string(&junk).unwrap(),
        "not a ticket at all",
        "a refusal must leave what git handed over untouched"
    );
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("leaving this conflict to git"),
        "the reason has to reach the terminal: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Too few paths is a misconfiguration, not a crash.
    let short = Command::new(env!("CARGO_BIN_EXE_gitteam"))
        .arg("merge-driver")
        .arg(&base)
        .output()
        .expect("the gitteam binary could not be started");
    assert!(!short.status.success());

    let _ = fs::remove_dir_all(&dir);
}
