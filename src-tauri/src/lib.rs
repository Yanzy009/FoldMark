mod document_service;

use document_service::{
    choose_document_library, choose_markdown_document, close_document, list_recent_documents,
    open_dropped_document, open_library_document, open_linked_document, open_pending_documents,
    open_recent_document, queue_markdown_paths, read_document_asset, read_markdown_document,
    AppState,
};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

fn paths_from_args(args: impl IntoIterator<Item = String>, cwd: &str) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                Path::new(cwd).join(path)
            }
        })
        .collect()
}

fn signal_pending_paths(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    queue_markdown_paths(app.state::<AppState>().inner(), paths);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("pending-open-documents", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            signal_pending_paths(app, paths_from_args(args, &cwd));
        }))
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            choose_markdown_document,
            choose_document_library,
            close_document,
            list_recent_documents,
            open_recent_document,
            open_dropped_document,
            open_library_document,
            open_linked_document,
            open_pending_documents,
            read_markdown_document,
            read_document_asset,
        ])
        .setup(|app| {
            let args = std::env::args().collect::<Vec<_>>();
            let cwd = std::env::current_dir().unwrap_or_default();
            let paths = paths_from_args(args, &cwd.to_string_lossy());
            queue_markdown_paths(app.state::<AppState>().inner(), paths);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build FoldMark")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    let paths = urls
                        .into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .collect();
                    signal_pending_paths(app, paths);
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_startup_paths_and_skips_executable() {
        let paths = paths_from_args(
            ["foldmark".to_string(), "中文文档.md".to_string()],
            "/tmp/foldmark",
        );
        assert_eq!(paths, vec![PathBuf::from("/tmp/foldmark/中文文档.md")]);
    }
}
