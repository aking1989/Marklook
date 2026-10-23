use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use percent_encoding::percent_decode_str;
use tauri::http::{Response, StatusCode, header};

use crate::state::AppState;

/// 图片扩展名白名单：mdasset 协议只服务图片，不服务任意文件。
const IMAGE_EXTENSIONS: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
];

/// 单个资源上限 20MB。
const MAX_ASSET_BYTES: u64 = 20 * 1024 * 1024;

/// 解析 mdasset 请求路径（形如 `/local/<base64url>?v=<mtime>`）为原始路径。
pub fn decode_asset_request(uri_path: &str) -> Option<String> {
    let decoded = percent_decode_str(uri_path.trim_start_matches('/'))
        .decode_utf8()
        .ok()?;
    let rest = decoded.strip_prefix("local/")?;
    let token = rest.split('?').next()?;
    if token.is_empty() {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(token).ok()?;
    String::from_utf8(bytes).ok()
}

fn content_type(path: &std::path::Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
}

fn is_image(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 资源授权：位于任一已打开根目录内，或位于任一已打开文件的同目录/子目录内。
/// canonicalize 消解符号链接后再做组件级前缀检查，拒绝逃逸。
pub fn ensure_asset_allowed(
    state: &AppState,
    raw: &str,
) -> Result<std::path::PathBuf, crate::error::CommandError> {
    let path = dunce::canonicalize(raw)
        .map_err(|_| crate::error::CommandError::NotFound(raw.to_string()))?;

    if !is_image(&path) {
        return Err(crate::error::CommandError::PathOutsideRoot(raw.to_string()));
    }

    if state.asset_allowed(&path) {
        Ok(path)
    } else {
        Err(crate::error::CommandError::PathOutsideRoot(raw.to_string()))
    }
}

/// 读取并返回资产字节与响应头。失败返回对应状态码。
pub fn serve_asset(state: &AppState, raw_path: &str) -> Response<Vec<u8>> {
    let path = match ensure_asset_allowed(state, raw_path) {
        Ok(path) => path,
        Err(_) => return error_response(StatusCode::FORBIDDEN, "forbidden"),
    };

    let meta = match std::fs::metadata(&path) {
        Ok(meta) => meta,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "not found"),
    };

    if !meta.is_file() {
        return error_response(StatusCode::FORBIDDEN, "forbidden");
    }
    if meta.len() > MAX_ASSET_BYTES {
        return error_response(StatusCode::PAYLOAD_TOO_LARGE, "too large");
    }

    let content_type = match content_type(&path) {
        Some(mime) => mime,
        None => return error_response(StatusCode::FORBIDDEN, "forbidden"),
    };

    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "not found"),
    };

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Content-Type-Options", "nosniff");

    // SVG 可能包含脚本，用严格 CSP 防止被当作文档执行。
    if content_type == "image/svg+xml" {
        builder = builder.header(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'",
        );
    }

    builder
        .body(bytes)
        .unwrap_or_else(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "internal error"))
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .expect("静态响应构造不会失败")
        })
}

/// 请求路径无法解析时的 404。
pub fn serve_asset_missing() -> Response<Vec<u8>> {
    error_response(StatusCode::NOT_FOUND, "not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn canonical(path: &std::path::Path) -> std::path::PathBuf {
        dunce::canonicalize(path).unwrap()
    }

    fn encode(path: &str) -> String {
        URL_SAFE_NO_PAD.encode(path.as_bytes())
    }

    #[test]
    fn decodes_asset_request_path() {
        let token = encode("/docs/assets/图 片.png");
        let uri = format!("/local/{token}?v=12345");
        assert_eq!(
            decode_asset_request(&uri).as_deref(),
            Some("/docs/assets/图 片.png")
        );
    }

    #[test]
    fn rejects_malformed_request_path() {
        assert!(decode_asset_request("/local/!!!not-base64!!!").is_none());
        assert!(decode_asset_request("/local/").is_none());
        assert!(decode_asset_request("/other/abc").is_none());
    }

    #[test]
    fn serves_image_next_to_allowed_document() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        let image = dir.path().join("pic.png");
        fs::write(&doc, "hi").unwrap();
        fs::write(&image, b"png-bytes").unwrap();

        let state = AppState::default();
        state.allow_file(canonical(&doc));

        let response = serve_asset(&state, image.to_str().unwrap());
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), b"png-bytes");
        let headers = response.headers();
        assert_eq!(headers.get(header::CONTENT_TYPE).unwrap(), "image/png");
        assert_eq!(headers.get(header::CACHE_CONTROL).unwrap(), "no-cache");
    }

    #[test]
    fn serves_image_in_subdirectory_of_allowed_document() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        let sub = dir.path().join("assets");
        fs::create_dir_all(&sub).unwrap();
        fs::write(&doc, "hi").unwrap();
        let image = sub.join("deep.svg");
        fs::write(&image, b"<svg/>").unwrap();

        let state = AppState::default();
        state.allow_file(canonical(&doc));

        let response = serve_asset(&state, image.to_str().unwrap());
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .unwrap(),
            "default-src 'none'; style-src 'unsafe-inline'"
        );
    }

    #[test]
    fn rejects_non_image_and_outside_allowlist() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        let script = dir.path().join("evil.js");
        fs::write(&doc, "hi").unwrap();
        fs::write(&script, b"alert(1)").unwrap();

        let outside = tempdir().unwrap();
        let secret = outside.path().join("secret.png");
        fs::write(&secret, b"png").unwrap();

        let state = AppState::default();
        state.allow_file(canonical(&doc));

        assert_eq!(
            serve_asset(&state, script.to_str().unwrap()).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            serve_asset(&state, secret.to_str().unwrap()).status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn rejects_oversized_asset() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        let image = dir.path().join("big.png");
        fs::write(&doc, "hi").unwrap();
        fs::write(&image, vec![0u8; (MAX_ASSET_BYTES + 1) as usize]).unwrap();

        let state = AppState::default();
        state.allow_file(canonical(&doc));

        assert_eq!(
            serve_asset(&state, image.to_str().unwrap()).status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_via_canonicalize() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let secret = outside.path().join("secret.png");
        fs::write(&secret, b"png").unwrap();
        let doc = dir.path().join("note.md");
        fs::write(&doc, "hi").unwrap();
        symlink(&secret, dir.path().join("link.png")).unwrap();

        let state = AppState::default();
        state.allow_file(canonical(&doc));

        let link = dir.path().join("link.png");
        assert_eq!(
            serve_asset(&state, link.to_str().unwrap()).status(),
            StatusCode::FORBIDDEN
        );
    }
}
