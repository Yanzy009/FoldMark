use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use encoding_rs::GBK;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_MARKDOWN_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ASSET_BYTES: u64 = 25 * 1024 * 1024;
const MAX_RECENT_DOCUMENTS: usize = 5;
const MAX_LIBRARY_DOCUMENTS: usize = 2_000;
const RECENT_DOCUMENTS_FILE: &str = "recent-documents.json";

#[derive(Clone, Debug)]
struct DocumentGrant {
    path: PathBuf,
    root: PathBuf,
}

#[derive(Clone, Debug)]
struct LibraryGrant {
    documents: HashMap<String, PathBuf>,
}

struct LibraryScan {
    documents: Vec<LibraryDocument>,
    grants: HashMap<String, PathBuf>,
    truncated: bool,
}

#[derive(Default)]
pub struct AppState {
    grants: Mutex<HashMap<String, DocumentGrant>>,
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    libraries: Mutex<HashMap<String, LibraryGrant>>,
    pending_paths: Mutex<Vec<PathBuf>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    token: String,
    name: String,
    display_path: String,
    markdown: String,
    size: u64,
    modified_millis: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPayload {
    mime_type: String,
    base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDocument {
    id: String,
    name: String,
    display_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocument {
    id: String,
    name: String,
    relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPayload {
    token: String,
    name: String,
    documents: Vec<LibraryDocument>,
    truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentChanged {
    token: String,
    kind: String,
}

fn canonical_markdown(path: &Path) -> Result<(PathBuf, PathBuf), String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("无法读取所选文件：{error}"))?;
    let metadata =
        fs::metadata(&canonical).map_err(|error| format!("无法读取文件信息：{error}"))?;
    if !metadata.is_file() {
        return Err("所选路径不是文件".into());
    }
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return Err("Markdown 文件超过 50 MB 安全上限".into());
    }
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("md") && !extension.eq_ignore_ascii_case("markdown") {
        return Err("只允许打开 .md 或 .markdown 文件".into());
    }
    let root = canonical
        .parent()
        .ok_or_else(|| "无法确定文档目录".to_string())?
        .canonicalize()
        .map_err(|error| format!("无法授权文档目录：{error}"))?;
    Ok((canonical, root))
}

fn read_markdown_text(path: &Path) -> Result<(String, fs::Metadata), String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 Markdown 失败：{error}"))?;
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let markdown = match std::str::from_utf8(bytes) {
        Ok(value) => value.to_string(),
        Err(_) => GBK
            .decode_without_bom_handling_and_without_replacement(bytes)
            .map(|value| value.into_owned())
            .ok_or_else(|| "无法识别文档编码；FoldMark 支持 UTF-8、GBK 和 GB18030".to_string())?,
    };
    let metadata = fs::metadata(path).map_err(|error| format!("读取文件信息失败：{error}"))?;
    Ok((markdown, metadata))
}

fn payload_for(token: String, grant: &DocumentGrant) -> Result<DocumentPayload, String> {
    let current = grant
        .path
        .canonicalize()
        .map_err(|error| format!("文档已移动或删除：{error}"))?;
    if current != grant.path || !current.starts_with(&grant.root) {
        return Err("文档路径已发生不安全的变化，请重新选择文件".into());
    }
    let (markdown, metadata) = read_markdown_text(&current)?;
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return Err("Markdown 文件超过 50 MB 安全上限".into());
    }
    let modified_millis = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    Ok(DocumentPayload {
        token,
        name: current
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名.md")
            .to_string(),
        display_path: current.to_string_lossy().into_owned(),
        markdown,
        size: metadata.len(),
        modified_millis,
    })
}

pub fn queue_markdown_paths(state: &AppState, paths: impl IntoIterator<Item = PathBuf>) {
    let Ok(mut pending) = state.pending_paths.lock() else {
        return;
    };
    for path in paths {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if (extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown"))
            && !pending.contains(&path)
        {
            pending.push(path);
        }
    }
}

#[tauri::command]
pub fn open_pending_documents(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DocumentPayload>, String> {
    let paths = {
        let mut pending = state
            .pending_paths
            .lock()
            .map_err(|_| "待打开文件队列不可用".to_string())?;
        std::mem::take(&mut *pending)
    };
    let mut documents = Vec::new();
    let mut first_error = None;
    for path in paths {
        match activate_document(app.clone(), state.inner(), &path) {
            Ok(document) => documents.push(document),
            Err(error) if first_error.is_none() => first_error = Some(error),
            Err(_) => {}
        }
    }
    if documents.is_empty() {
        if let Some(error) = first_error {
            return Err(error);
        }
    }
    Ok(documents)
}

fn linked_markdown_path(grant: &DocumentGrant, relative_path: &str) -> Result<PathBuf, String> {
    let without_fragment = relative_path.split(['?', '#']).next().unwrap_or_default();
    let decoded = percent_decode_str(without_fragment)
        .decode_utf8()
        .map_err(|_| "文档链接不是有效的 UTF-8".to_string())?;
    let relative = Path::new(decoded.as_ref());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("文档链接超出当前目录的只读授权范围".into());
    }
    let linked = grant.root.join(relative);
    canonical_markdown(&linked).map(|(path, _)| path)
}

#[tauri::command]
pub fn open_linked_document(
    token: String,
    relative_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    let grant = state
        .grants
        .lock()
        .map_err(|_| "文档授权状态不可用".to_string())?
        .get(&token)
        .cloned()
        .ok_or_else(|| "文档授权已失效，请重新选择文件".to_string())?;
    let linked = linked_markdown_path(&grant, &relative_path)?;
    activate_document(app, state.inner(), &linked)
}

fn start_watcher(
    app: AppHandle,
    token: &str,
    grant: &DocumentGrant,
) -> Result<RecommendedWatcher, String> {
    let watched_path = grant.path.clone();
    let watched_name = grant.path.file_name().map(|value| value.to_os_string());
    let event_token = token.to_string();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else {
                return;
            };
            let relates_to_document = event.paths.iter().any(|candidate| {
                candidate == &watched_path
                    || watched_name
                        .as_ref()
                        .is_some_and(|name| candidate.file_name() == Some(name.as_os_str()))
            });
            if relates_to_document {
                let _ = app.emit(
                    "document-changed",
                    DocumentChanged {
                        token: event_token.clone(),
                        kind: format!("{:?}", event.kind),
                    },
                );
            }
        },
        Config::default(),
    )
    .map_err(|error| format!("无法创建文件监听器：{error}"))?;
    watcher
        .watch(&grant.root, RecursiveMode::NonRecursive)
        .map_err(|error| format!("无法监听文档目录：{error}"))?;
    watcher
        .watch(&grant.path, RecursiveMode::NonRecursive)
        .map_err(|error| format!("无法监听文档：{error}"))?;
    Ok(watcher)
}

fn recent_documents_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(RECENT_DOCUMENTS_FILE))
        .map_err(|error| format!("无法确定最近文件配置目录：{error}"))
}

fn load_recent_documents(app: &AppHandle) -> Result<Vec<RecentDocument>, String> {
    let path = recent_documents_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|error| format!("无法读取最近文件列表：{error}"))?;
    let mut documents: Vec<RecentDocument> =
        serde_json::from_slice(&bytes).map_err(|error| format!("最近文件列表格式无效：{error}"))?;
    documents.truncate(MAX_RECENT_DOCUMENTS);
    Ok(documents)
}

fn save_recent_documents(app: &AppHandle, documents: &[RecentDocument]) -> Result<(), String> {
    let path = recent_documents_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "无法确定最近文件配置目录".to_string())?;
    fs::create_dir_all(directory).map_err(|error| format!("无法创建配置目录：{error}"))?;
    let bytes = serde_json::to_vec_pretty(documents)
        .map_err(|error| format!("无法生成最近文件列表：{error}"))?;
    fs::write(path, bytes).map_err(|error| format!("无法保存最近文件列表：{error}"))
}

fn upsert_recent_document(documents: &mut Vec<RecentDocument>, path: &Path) {
    let display_path = path.to_string_lossy().into_owned();
    let existing_id = documents
        .iter()
        .find(|document| document.display_path == display_path)
        .map(|document| document.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    documents.retain(|document| document.display_path != display_path);
    documents.insert(
        0,
        RecentDocument {
            id: existing_id,
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("未命名.md")
                .to_string(),
            display_path,
        },
    );
    documents.truncate(MAX_RECENT_DOCUMENTS);
}

fn record_recent_document(app: &AppHandle, path: &Path) -> Result<(), String> {
    let mut documents = load_recent_documents(app).unwrap_or_default();
    upsert_recent_document(&mut documents, path);
    save_recent_documents(app, &documents)
}

fn activate_document(
    app: AppHandle,
    state: &AppState,
    selected_path: &Path,
) -> Result<DocumentPayload, String> {
    let (path, root) = canonical_markdown(selected_path)?;
    let token = Uuid::new_v4().to_string();
    let grant = DocumentGrant {
        path: path.clone(),
        root,
    };
    let payload = payload_for(token.clone(), &grant)?;
    let watcher = start_watcher(app.clone(), &token, &grant)?;
    let mut grants = state
        .grants
        .lock()
        .map_err(|_| "文档授权状态不可用".to_string())?;
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "文件监听状态不可用".to_string())?;
    grants.insert(token.clone(), grant);
    watchers.insert(token, watcher);
    drop(watchers);
    drop(grants);
    // 最近文件只是便捷入口；即使配置目录暂时不可写，也不能让已经
    // 通过安全校验并成功载入的文档在前端被误报为“打开失败”。
    if let Err(error) = record_recent_document(&app, &path) {
        eprintln!("无法更新最近文件列表：{error}");
    }
    Ok(payload)
}

#[tauri::command]
pub fn close_document(token: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .grants
        .lock()
        .map_err(|_| "文档授权状态不可用".to_string())?
        .remove(&token);
    state
        .watchers
        .lock()
        .map_err(|_| "文件监听状态不可用".to_string())?
        .remove(&token);
    Ok(())
}

fn asset_path(grant: &DocumentGrant, relative_url: &str) -> Result<(PathBuf, String), String> {
    let without_fragment = relative_url.split(['?', '#']).next().unwrap_or_default();
    let decoded = percent_decode_str(without_fragment)
        .decode_utf8()
        .map_err(|_| "图片路径不是有效的 UTF-8".to_string())?;
    let relative = Path::new(decoded.as_ref());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("图片路径超出文档授权范围".into());
    }
    let canonical = grant
        .root
        .join(relative)
        .canonicalize()
        .map_err(|error| format!("无法读取本地图片：{error}"))?;
    if !canonical.starts_with(&grant.root) {
        return Err("图片路径超出文档授权范围".into());
    }
    let metadata =
        fs::metadata(&canonical).map_err(|error| format!("无法读取图片信息：{error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_ASSET_BYTES {
        return Err("本地图片无效或超过 25 MB".into());
    }
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("当前只允许读取 PNG、JPEG、GIF 或 WebP 图片".into()),
    };
    Ok((canonical, mime.to_string()))
}

fn scan_library(root: &Path) -> Result<LibraryScan, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut documents = Vec::new();
    let mut grants = HashMap::new();
    let mut truncated = false;

    while let Some(directory) = stack.pop() {
        let entries =
            fs::read_dir(&directory).map_err(|error| format!("无法读取文档库目录：{error}"))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("无法读取文档库条目：{error}"))?;
            let path = entry.path();
            let name = entry.file_name();
            if name.to_string_lossy().starts_with('.') {
                continue;
            }
            let file_type = entry
                .file_type()
                .map_err(|error| format!("无法读取文档库条目类型：{error}"))?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if matches!(
                    name.to_string_lossy().as_ref(),
                    "node_modules" | "target" | "dist"
                ) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if extension != "md" && extension != "markdown" {
                continue;
            }
            if documents.len() >= MAX_LIBRARY_DOCUMENTS {
                truncated = true;
                break;
            }
            let canonical = path
                .canonicalize()
                .map_err(|error| format!("无法解析文档库文件：{error}"))?;
            if !canonical.starts_with(root) {
                continue;
            }
            let relative_path = canonical
                .strip_prefix(root)
                .map_err(|_| "文档库文件超出授权范围".to_string())?
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            let id = Uuid::new_v4().to_string();
            documents.push(LibraryDocument {
                id: id.clone(),
                name: canonical
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("未命名.md")
                    .to_string(),
                relative_path,
            });
            grants.insert(id, canonical);
        }
        if truncated {
            break;
        }
    }

    documents.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(LibraryScan {
        documents,
        grants,
        truncated,
    })
}

#[tauri::command]
pub async fn choose_document_library(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<LibraryPayload>, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog().file().pick_folder(move |selected| {
        let _ = sender.blocking_send(selected);
    });
    let selected = receiver
        .recv()
        .await
        .ok_or_else(|| "文件夹选择器意外关闭，请重试".to_string())?;
    let Some(folder) = selected else {
        return Ok(None);
    };
    let root = folder
        .into_path()
        .map_err(|error| format!("无法解析所选文件夹：{error}"))?
        .canonicalize()
        .map_err(|error| format!("无法读取所选文件夹：{error}"))?;
    if !root.is_dir() {
        return Err("所选路径不是文件夹".into());
    }
    let scan = scan_library(&root)?;
    let token = Uuid::new_v4().to_string();
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Markdown 文档库")
        .to_string();
    let mut libraries = state
        .libraries
        .lock()
        .map_err(|_| "文档库授权状态不可用".to_string())?;
    libraries.clear();
    libraries.insert(
        token.clone(),
        LibraryGrant {
            documents: scan.grants,
        },
    );
    Ok(Some(LibraryPayload {
        token,
        name,
        documents: scan.documents,
        truncated: scan.truncated,
    }))
}

#[tauri::command]
pub fn open_library_document(
    library_token: String,
    document_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    let path = state
        .libraries
        .lock()
        .map_err(|_| "文档库授权状态不可用".to_string())?
        .get(&library_token)
        .and_then(|library| library.documents.get(&document_id))
        .cloned()
        .ok_or_else(|| "文档库授权已失效，请重新选择文件夹".to_string())?;
    activate_document(app, state.inner(), &path)
}

#[tauri::command]
pub fn open_dropped_document(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    // Native file drops are explicit user actions, but still pass through the
    // same path, extension, size and UTF-8 checks as the file picker.
    activate_document(app, state.inner(), Path::new(&path))
}

#[tauri::command]
pub async fn choose_markdown_document(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<DocumentPayload>, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file(move |selected| {
            // 回调由插件的后台线程执行；异步命令在这里等待结果，不阻塞 macOS 主事件循环。
            let _ = sender.blocking_send(selected);
        });
    let selected = receiver
        .recv()
        .await
        .ok_or_else(|| "文件选择器意外关闭，请重试".to_string())?;
    let Some(file_path) = selected else {
        return Ok(None);
    };
    let path = file_path
        .into_path()
        .map_err(|error| format!("无法解析所选文件路径：{error}"))?;
    activate_document(app, state.inner(), &path).map(Some)
}

#[tauri::command]
pub fn list_recent_documents(app: AppHandle) -> Result<Vec<RecentDocument>, String> {
    load_recent_documents(&app)
}

#[tauri::command]
pub fn open_recent_document(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    let documents = load_recent_documents(&app)?;
    let recent = documents
        .iter()
        .find(|document| document.id == id)
        .ok_or_else(|| "最近文件记录不存在，请重新选择文件".to_string())?;
    activate_document(app, state.inner(), Path::new(&recent.display_path))
}

#[tauri::command]
pub fn read_markdown_document(
    token: String,
    state: State<'_, AppState>,
) -> Result<DocumentPayload, String> {
    let grant = state
        .grants
        .lock()
        .map_err(|_| "文档授权状态不可用".to_string())?
        .get(&token)
        .cloned()
        .ok_or_else(|| "文档授权已失效，请重新选择文件".to_string())?;
    payload_for(token, &grant)
}

#[tauri::command]
pub fn read_document_asset(
    token: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<AssetPayload, String> {
    let grant = state
        .grants
        .lock()
        .map_err(|_| "文档授权状态不可用".to_string())?
        .get(&token)
        .cloned()
        .ok_or_else(|| "文档授权已失效，请重新选择文件".to_string())?;
    let (path, mime_type) = asset_path(&grant, &relative_path)?;
    let bytes = fs::read(path).map_err(|error| format!("读取本地图片失败：{error}"))?;
    Ok(AssetPayload {
        mime_type,
        base64: BASE64.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn accepts_utf8_markdown_and_bom() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("测试.md");
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(&[0xEF, 0xBB, 0xBF]).unwrap();
        file.write_all("# 中文".as_bytes()).unwrap();
        let (canonical, _) = canonical_markdown(&path).unwrap();
        let (content, _) = read_markdown_text(&canonical).unwrap();
        assert_eq!(content, "# 中文");
    }

    #[test]
    fn accepts_gbk_chinese_markdown() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("旧文档.md");
        let (bytes, _, had_errors) = GBK.encode("# 中文标题\n正文");
        assert!(!had_errors);
        fs::write(&path, bytes.as_ref()).unwrap();
        let (content, _) = read_markdown_text(&path).unwrap();
        assert_eq!(content, "# 中文标题\n正文");
    }

    #[test]
    fn rejects_non_markdown_extension() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("secret.txt");
        fs::write(&path, "secret").unwrap();
        assert!(canonical_markdown(&path).is_err());
    }

    #[test]
    fn rejects_invalid_utf8() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("broken.md");
        fs::write(&path, [0xFF, 0xFE]).unwrap();
        assert!(read_markdown_text(&path).is_err());
    }

    #[test]
    fn reads_asset_inside_authorized_directory() {
        let directory = tempfile::tempdir().unwrap();
        let document = directory.path().join("guide.md");
        let image = directory.path().join("chart.png");
        fs::write(&document, "![chart](chart.png)").unwrap();
        fs::write(&image, [0x89, 0x50, 0x4E, 0x47]).unwrap();
        let (path, root) = canonical_markdown(&document).unwrap();
        let grant = DocumentGrant { path, root };
        let (resolved, mime) = asset_path(&grant, "chart.png").unwrap();
        assert_eq!(resolved, image.canonicalize().unwrap());
        assert_eq!(mime, "image/png");
    }

    #[test]
    fn rejects_parent_directory_asset() {
        let parent = tempfile::tempdir().unwrap();
        let directory = parent.path().join("docs");
        fs::create_dir(&directory).unwrap();
        let document = directory.join("guide.md");
        fs::write(&document, "![secret](../secret.png)").unwrap();
        fs::write(parent.path().join("secret.png"), "secret").unwrap();
        let (path, root) = canonical_markdown(&document).unwrap();
        let grant = DocumentGrant { path, root };
        assert!(asset_path(&grant, "../secret.png").is_err());
    }

    #[test]
    fn linked_markdown_stays_inside_authorized_directory() {
        let parent = tempfile::tempdir().unwrap();
        let directory = parent.path().join("docs");
        fs::create_dir(&directory).unwrap();
        let current = directory.join("current.md");
        let linked = directory.join("下一章.md");
        fs::write(&current, "[下一章](下一章.md)").unwrap();
        fs::write(&linked, "# 下一章").unwrap();
        fs::write(parent.path().join("secret.md"), "secret").unwrap();
        let (path, root) = canonical_markdown(&current).unwrap();
        let grant = DocumentGrant { path, root };
        assert_eq!(
            linked_markdown_path(&grant, "%E4%B8%8B%E4%B8%80%E7%AB%A0.md#开头").unwrap(),
            linked.canonicalize().unwrap()
        );
        assert!(linked_markdown_path(&grant, "../secret.md").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_asset_escape() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let directory = parent.path().join("docs");
        fs::create_dir(&directory).unwrap();
        let document = directory.join("guide.md");
        let secret = parent.path().join("secret.png");
        fs::write(&document, "![secret](linked.png)").unwrap();
        fs::write(&secret, "secret").unwrap();
        symlink(&secret, directory.join("linked.png")).unwrap();
        let (path, root) = canonical_markdown(&document).unwrap();
        let grant = DocumentGrant { path, root };
        assert!(asset_path(&grant, "linked.png").is_err());
    }

    #[test]
    fn recent_documents_move_existing_file_to_front_and_limit_length() {
        assert_eq!(MAX_RECENT_DOCUMENTS, 5);
        let mut documents = (0..(MAX_RECENT_DOCUMENTS + 3))
            .map(|index| RecentDocument {
                id: index.to_string(),
                name: format!("{index}.md"),
                display_path: format!("/tmp/{index}.md"),
            })
            .collect::<Vec<_>>();
        upsert_recent_document(&mut documents, Path::new("/tmp/4.md"));
        assert_eq!(documents.len(), MAX_RECENT_DOCUMENTS);
        assert_eq!(documents[0].id, "4");
        assert_eq!(documents[0].display_path, "/tmp/4.md");

        upsert_recent_document(&mut documents, Path::new("/tmp/new.md"));
        assert_eq!(documents.len(), MAX_RECENT_DOCUMENTS);
        assert_eq!(documents[0].name, "new.md");
    }

    #[test]
    fn library_scan_is_recursive_sorted_and_markdown_only() {
        let directory = tempfile::tempdir().unwrap();
        let nested = directory.path().join("02_资料");
        let hidden = directory.path().join(".private");
        let dependencies = directory.path().join("node_modules");
        fs::create_dir(&nested).unwrap();
        fs::create_dir(&hidden).unwrap();
        fs::create_dir(&dependencies).unwrap();
        fs::write(directory.path().join("01_开始.md"), "# start").unwrap();
        fs::write(nested.join("指南.markdown"), "# guide").unwrap();
        fs::write(nested.join("忽略.txt"), "ignore").unwrap();
        fs::write(hidden.join("秘密.md"), "ignore").unwrap();
        fs::write(dependencies.join("README.md"), "ignore").unwrap();

        let root = directory.path().canonicalize().unwrap();
        let scan = scan_library(&root).unwrap();
        let paths = scan
            .documents
            .iter()
            .map(|document| document.relative_path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["01_开始.md", "02_资料/指南.markdown"]);
        assert_eq!(scan.grants.len(), 2);
        assert!(!scan.truncated);
    }
}
