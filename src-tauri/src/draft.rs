use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::error::CommandError;

/// 单条草稿上限 20MB：超过则不写草稿（前端提示手动保存）。
const MAX_DRAFT_BYTES: usize = 20 * 1024 * 1024;

/// 草稿保留 7 天。
const MAX_DRAFT_AGE_SECS: u64 = 7 * 24 * 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecord {
    pub path: String,
    pub content: String,
    pub baseline_mtime_ms: u64,
    pub saved_at: u64,
    pub version: u32,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// 草稿文件名：sha256(规范化路径) + .json，避免路径分隔符问题。
pub fn draft_file_name(canonical_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_path.as_bytes());
    let digest = hasher.finalize();
    let mut name = String::with_capacity(64 + 5);
    for byte in digest {
        name.push_str(&format!("{byte:02x}"));
    }
    name.push_str(".json");
    name
}

pub fn save_draft(dir: &Path, record: DraftRecord) -> Result<(), CommandError> {
    if record.content.len() > MAX_DRAFT_BYTES {
        return Err(CommandError::TooLarge(MAX_DRAFT_BYTES as u64));
    }

    fs::create_dir_all(dir).map_err(CommandError::io)?;
    let file = dir.join(draft_file_name(&record.path));
    let json =
        serde_json::to_string(&record).map_err(|error| CommandError::Io(error.to_string()))?;
    // 原子写：草稿损坏不如缺失。
    crate::io::atomic_write(&file, json.as_bytes())
}

pub fn load_draft(dir: &Path, canonical_path: &str) -> Option<DraftRecord> {
    let file = dir.join(draft_file_name(canonical_path));
    let json = fs::read_to_string(file).ok()?;
    let record: DraftRecord = serde_json::from_str(&json).ok()?;
    (record.version == 1).then_some(record)
}

pub fn clear_draft(dir: &Path, canonical_path: &str) {
    let _ = fs::remove_file(dir.join(draft_file_name(canonical_path)));
}

/// 清理超过保留期的草稿，返回删除条数。启动时调用。
pub fn cleanup_old_drafts(dir: &Path) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };

    let mut removed = 0;
    let now = now_secs();
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        if now.saturating_sub(modified) > MAX_DRAFT_AGE_SECS
            && fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    removed
}

/// 确保草稿目录存在并返回其路径（应用数据目录 / drafts）。
pub fn drafts_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::Io(error.to_string()))?
        .join("drafts");
    fs::create_dir_all(&dir).map_err(CommandError::io)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_record(path: &str, content: &str) -> DraftRecord {
        DraftRecord {
            path: path.to_string(),
            content: content.to_string(),
            baseline_mtime_ms: 1000,
            saved_at: now_secs(),
            version: 1,
        }
    }

    #[test]
    fn draft_file_name_is_stable_sha256() {
        let first = draft_file_name("/docs/note.md");
        let second = draft_file_name("/docs/note.md");
        let other = draft_file_name("/docs/other.md");

        assert_eq!(first, second);
        assert_ne!(first, other);
        assert!(first.ends_with(".json"));
        assert_eq!(first.len(), 64 + 5);
    }

    #[test]
    fn save_load_clear_round_trip() {
        let dir = tempdir().unwrap();
        let record = sample_record("/tmp/a.md", "草稿内容");

        save_draft(dir.path(), record.clone()).unwrap();

        let loaded = load_draft(dir.path(), "/tmp/a.md").unwrap();
        assert_eq!(loaded.content, "草稿内容");
        assert_eq!(loaded.baseline_mtime_ms, 1000);
        assert_eq!(loaded.version, 1);

        clear_draft(dir.path(), "/tmp/a.md");
        assert!(load_draft(dir.path(), "/tmp/a.md").is_none());
    }

    #[test]
    fn rejects_oversized_draft() {
        let dir = tempdir().unwrap();
        let record = sample_record("/tmp/big.md", &"x".repeat(MAX_DRAFT_BYTES + 1));

        let error = save_draft(dir.path(), record).unwrap_err();
        assert!(matches!(error, CommandError::TooLarge(_)));
        assert!(load_draft(dir.path(), "/tmp/big.md").is_none());
    }

    #[test]
    fn corrupted_draft_is_ignored() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(draft_file_name("/tmp/bad.md"));
        fs::write(&file, "not json").unwrap();

        assert!(load_draft(dir.path(), "/tmp/bad.md").is_none());
    }

    #[test]
    fn cleanup_removes_only_expired_drafts() {
        let dir = tempdir().unwrap();
        save_draft(dir.path(), sample_record("/tmp/new.md", "new")).unwrap();

        let old = dir.path().join(draft_file_name("/tmp/old.md"));
        fs::write(
            &old,
            serde_json::to_string(&sample_record("/tmp/old.md", "old")).unwrap(),
        )
        .unwrap();
        // 把 mtime 改到 8 天前。
        let past =
            SystemTime::now() - std::time::Duration::from_secs(MAX_DRAFT_AGE_SECS + 24 * 3600);
        let _ = fs::File::options()
            .write(true)
            .open(&old)
            .and_then(|handle| handle.set_modified(past));

        let removed = cleanup_old_drafts(dir.path());

        assert_eq!(removed, 1);
        assert!(load_draft(dir.path(), "/tmp/old.md").is_none());
        assert!(load_draft(dir.path(), "/tmp/new.md").is_some());
    }
}
