use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        RwLock,
        atomic::{AtomicBool, Ordering},
    },
};

use crate::error::CommandError;

#[derive(Default)]
pub struct AppState {
    allowed_roots: RwLock<HashSet<PathBuf>>,
    allowed_files: RwLock<HashSet<PathBuf>>,
    pending_open: RwLock<Vec<PathBuf>>,
    /// 用户已在前端确认关闭：放行下一次 CloseRequested。
    force_close: AtomicBool,
}

impl AppState {
    pub fn allow_root(&self, path: PathBuf) {
        self.allowed_roots
            .write()
            .expect("allowed_roots poisoned")
            .insert(path);
    }

    pub fn allow_file(&self, path: PathBuf) {
        self.allowed_files
            .write()
            .expect("allowed_files poisoned")
            .insert(path);
    }

    #[allow(dead_code)] // 文件关联与单实例在 M4 接入
    pub fn push_pending_open(&self, paths: Vec<PathBuf>) {
        if paths.is_empty() {
            return;
        }
        let mut pending = self.pending_open.write().expect("pending_open poisoned");
        for path in paths {
            if !pending.contains(&path) {
                pending.push(path);
            }
        }
    }

    pub fn set_force_close(&self, value: bool) {
        self.force_close.store(value, Ordering::SeqCst);
    }

    pub fn take_force_close(&self) -> bool {
        self.force_close.swap(false, Ordering::SeqCst)
    }

    pub fn take_pending_open(&self) -> Vec<String> {
        self.pending_open
            .write()
            .expect("pending_open poisoned")
            .drain(..)
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    }

    /// 规范化路径，并确认它位于用户显式打开过的根目录或文件白名单内。
    pub fn ensure_allowed(&self, raw: &str) -> Result<PathBuf, CommandError> {
        let path = dunce::canonicalize(raw).map_err(|_| CommandError::NotFound(raw.to_string()))?;

        let files = self.allowed_files.read().expect("allowed_files poisoned");
        let roots = self.allowed_roots.read().expect("allowed_roots poisoned");

        let allowed = files.contains(&path) || roots.iter().any(|root| path.starts_with(root));

        if !allowed {
            return Err(CommandError::PathOutsideRoot(raw.to_string()));
        }

        Ok(path)
    }

    /// 资源授权（mdasset 协议）：路径位于任一已打开根目录内，
    /// 或位于任一已打开文件的同目录/子目录树内。调用方需先 canonicalize。
    pub fn asset_allowed(&self, path: &std::path::Path) -> bool {
        let files = self.allowed_files.read().expect("allowed_files poisoned");
        let roots = self.allowed_roots.read().expect("allowed_roots poisoned");

        if roots.iter().any(|root| path.starts_with(root)) {
            return true;
        }
        files.iter().any(|file| {
            file.parent()
                .map(|dir| path.starts_with(dir))
                .unwrap_or(false)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn canonical(path: &std::path::Path) -> PathBuf {
        dunce::canonicalize(path).unwrap()
    }

    #[test]
    fn allows_files_inside_an_opened_root() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.md");
        fs::write(&file, "hello").unwrap();

        let state = AppState::default();
        state.allow_root(canonical(dir.path()));

        let result = state.ensure_allowed(file.to_str().unwrap());
        assert!(result.is_ok());
    }

    #[test]
    fn allows_a_single_opened_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.md");
        fs::write(&file, "hello").unwrap();

        let state = AppState::default();
        state.allow_file(canonical(&file));

        let result = state.ensure_allowed(file.to_str().unwrap());
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_files_outside_the_allowlist() {
        let allowed = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let file = outside.path().join("secret.md");
        fs::write(&file, "secret").unwrap();

        let state = AppState::default();
        state.allow_root(canonical(allowed.path()));

        let error = state.ensure_allowed(file.to_str().unwrap()).unwrap_err();
        assert!(matches!(error, CommandError::PathOutsideRoot(_)));
    }

    #[test]
    fn prefix_check_is_component_wise() {
        let base = tempdir().unwrap();
        let root = base.path().join("root");
        let sibling = base.path().join("root2");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        let file = sibling.join("note.md");
        fs::write(&file, "hello").unwrap();

        let state = AppState::default();
        state.allow_root(canonical(&root));

        let error = state.ensure_allowed(file.to_str().unwrap()).unwrap_err();
        assert!(matches!(error, CommandError::PathOutsideRoot(_)));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let secret = outside.path().join("secret.md");
        fs::write(&secret, "secret").unwrap();
        let link = root.path().join("link.md");
        symlink(&secret, &link).unwrap();

        let state = AppState::default();
        state.allow_root(canonical(root.path()));

        let error = state.ensure_allowed(link.to_str().unwrap()).unwrap_err();
        assert!(matches!(error, CommandError::PathOutsideRoot(_)));
    }
}
