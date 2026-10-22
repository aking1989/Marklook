use serde::Serialize;

#[derive(Debug, Serialize, thiserror::Error)]
#[serde(tag = "code", content = "data", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CommandError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("invalid utf-8: {0}")]
    InvalidUtf8(String),
    #[error("conflict")]
    Conflict { current_mtime_ms: u64 },
    #[error("io error: {0}")]
    Io(String),
    #[error("path outside allowed roots: {0}")]
    PathOutsideRoot(String),
    #[allow(dead_code)]
    #[error("file too large: {0} bytes")]
    TooLarge(u64),
    #[allow(dead_code)]
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[allow(dead_code)]
    #[error("cancelled")]
    Cancelled,
}

impl CommandError {
    pub fn io(error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => Self::NotFound(error.to_string()),
            std::io::ErrorKind::PermissionDenied => Self::PermissionDenied(error.to_string()),
            _ => Self::Io(error.to_string()),
        }
    }
}
