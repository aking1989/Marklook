use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU32, Ordering},
    },
    time::Duration,
};

use notify_debouncer_mini::{DebouncedEvent, Debouncer, new_debouncer};
use serde::Serialize;

use crate::error::CommandError;

/// 去抖窗口：编辑器"写临时文件 + rename"式的保存会触发一串事件。
const DEBOUNCE_MS: u64 = 300;

const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangePayload {
    pub watch_id: u32,
    pub paths: Vec<String>,
}

pub struct WatchRegistry {
    watchers: Mutex<HashMap<u32, Debouncer<notify::RecommendedWatcher>>>,
    next_id: AtomicU32,
}

impl Default for WatchRegistry {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

impl WatchRegistry {
    pub fn remove(&self, id: u32) {
        self.watchers.lock().expect("watchers poisoned").remove(&id); // drop 即停止监听
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.watchers.lock().expect("watchers poisoned").len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

fn is_markdown(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MARKDOWN_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/**
 * 创建去抖监听器。on_event 在去抖窗口结束后收到合并的路径列表。
 * - markdown_only：只上报 Markdown 扩展名（工作区树刷新用）。
 * - target_file：单文档监听时按文件名过滤（任意扩展名，捕获 rename 保存）。
 *
 * on_event 以回调注入，便于单元测试（不依赖 Tauri 事件循环）。
 */
pub fn spawn_watcher(
    id: u32,
    paths: Vec<PathBuf>,
    recursive: bool,
    markdown_only: bool,
    target_file: Option<String>,
    mut on_event: impl FnMut(FsChangePayload) + Send + 'static,
) -> Result<Debouncer<notify::RecommendedWatcher>, CommandError> {
    let mode = if recursive {
        notify::RecursiveMode::Recursive
    } else {
        notify::RecursiveMode::NonRecursive
    };

    let debounced: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        move |events: Result<Vec<DebouncedEvent>, notify::Error>| {
            let Ok(events) = events else {
                return;
            };

            let mut changed = debounced.lock().expect("debounced poisoned");
            for event in events {
                changed.push(event.path);
            }
            if changed.is_empty() {
                return;
            }

            let pending: Vec<PathBuf> = std::mem::take(&mut *changed);
            let matched: Vec<String> = pending
                .into_iter()
                .filter(|path| match (&target_file, markdown_only) {
                    (Some(file), _) => path
                        .file_name()
                        .map(|n| n == file.as_str())
                        .unwrap_or(false),
                    (None, true) => is_markdown(path),
                    (None, false) => true,
                })
                .map(|path| path.to_string_lossy().into_owned())
                .collect();

            if !matched.is_empty() {
                on_event(FsChangePayload {
                    watch_id: id,
                    paths: matched,
                });
            }
        },
    )
    .map_err(|_| CommandError::Unsupported("文件监听不可用".to_string()))?;

    for path in &paths {
        debouncer
            .watcher()
            .watch(path, mode)
            .map_err(|_| CommandError::Unsupported(format!("无法监听：{path:?}")))?;
    }

    Ok(debouncer)
}

pub fn register(
    registry: &WatchRegistry,
    paths: Vec<PathBuf>,
    recursive: bool,
    markdown_only: bool,
    target_file: Option<String>,
    on_event: impl FnMut(FsChangePayload) + Send + 'static,
) -> Result<u32, CommandError> {
    let id = registry.next_id.fetch_add(1, Ordering::Relaxed);
    let watcher = spawn_watcher(id, paths, recursive, markdown_only, target_file, on_event)?;
    registry
        .watchers
        .lock()
        .expect("watchers poisoned")
        .insert(id, watcher);
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::mpsc,
        time::{Duration, Instant},
    };
    use tempfile::tempdir;

    fn wait_for_event(
        receiver: &mpsc::Receiver<FsChangePayload>,
        timeout: Duration,
    ) -> Option<FsChangePayload> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Ok(payload) = receiver.recv_timeout(Duration::from_millis(100)) {
                return Some(payload);
            }
        }
        None
    }

    #[test]
    fn reports_markdown_changes_after_debounce() {
        let dir = tempdir().unwrap();
        let (sender, receiver) = mpsc::channel();

        let watcher = spawn_watcher(
            7,
            vec![dir.path().to_path_buf()],
            false,
            true,
            None,
            move |payload| {
                sender.send(payload).unwrap();
            },
        )
        .unwrap();

        fs::write(dir.path().join("note.md"), "hello").unwrap();

        let payload = wait_for_event(&receiver, Duration::from_secs(5)).unwrap();
        assert_eq!(payload.watch_id, 7);
        assert!(payload.paths.iter().all(|path| path.ends_with("note.md")));

        drop(watcher);
    }

    #[test]
    fn filters_out_non_markdown_when_markdown_only() {
        let dir = tempdir().unwrap();
        let (sender, receiver) = mpsc::channel();

        let watcher = spawn_watcher(
            1,
            vec![dir.path().to_path_buf()],
            false,
            true,
            None,
            move |payload| {
                sender.send(payload).unwrap();
            },
        )
        .unwrap();

        fs::write(dir.path().join("data.bin"), b"x").unwrap();
        fs::write(dir.path().join("doc.md"), "y").unwrap();

        let payload = wait_for_event(&receiver, Duration::from_secs(5)).unwrap();
        assert!(payload.paths.iter().all(|path| path.ends_with("doc.md")));
        assert!(!payload.paths.iter().any(|path| path.ends_with("data.bin")));

        drop(watcher);
    }

    #[test]
    fn target_file_filter_matches_any_extension() {
        let dir = tempdir().unwrap();
        let (sender, receiver) = mpsc::channel();

        let watcher = spawn_watcher(
            2,
            vec![dir.path().to_path_buf()],
            false,
            false,
            Some("note.md".to_string()),
            move |payload| {
                sender.send(payload).unwrap();
            },
        )
        .unwrap();

        // 同目录其他文件的变更不上报。
        fs::write(dir.path().join("other.md"), "x").unwrap();
        fs::write(dir.path().join("note.md"), "y").unwrap();

        let payload = wait_for_event(&receiver, Duration::from_secs(5)).unwrap();
        assert!(payload.paths.iter().all(|path| path.ends_with("note.md")));

        drop(watcher);
    }

    #[test]
    fn registry_registers_and_removes() {
        let dir = tempdir().unwrap();
        let registry = WatchRegistry::default();

        let id = register(
            &registry,
            vec![dir.path().to_path_buf()],
            false,
            true,
            None,
            |_| {},
        )
        .unwrap();

        assert_eq!(registry.len(), 1);
        registry.remove(id);
        assert!(registry.is_empty());
    }
}
