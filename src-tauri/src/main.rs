// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // git runs this same binary as the merge driver for ticket files, handing it
    // the three versions as arguments. That path must never open a window.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("merge-driver") {
        std::process::exit(gitteam_lib::merge_driver_main(&args[2..]));
    }
    gitteam_lib::run()
}
