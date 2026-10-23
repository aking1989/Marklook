# 代码签名与分发说明

墨览（Marklook）v1.0 阶段**不做强制签名**：安装包由 GitHub Actions 构建（见 `.github/workflows/release.yml`），个人使用可直接下载。

## 现状

| 平台 | 产物 | 签名状态 | 用户影响 |
| --- | --- | --- | --- |
| macOS | `.dmg` / `.app.tar.gz`（universal） | 未签名、未公证 | 首次打开需右键 → 打开，或 `xattr -d com.apple.quarantine` |
| Windows | NSIS `.exe` 安装包 | 未签名 | SmartScreen 可能提示"未知发布者"，选"仍要运行" |

## 启用签名（公开发布前）

### macOS（Apple Developer Program，$99/年）

1. `security find-identity -v -p codesigning` 确认证书（需 "Developer ID Application"）。
2. 导出环境变量到 GitHub Actions Secrets：`APPLE_CERTIFICATE`（p12 base64）、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`（应用专用密码）、`APPLE_TEAM_ID`。
3. `tauri.conf.json` 增加 `bundle.macOS.signingIdentity`，或使用 [tauri-action](https://github.com/tauri-apps/tauri-action)（自动公证）。

### Windows（代码签名证书，OV ~$100–300/年）

1. 购买 OV/EV 证书（EV 可立即消除 SmartScreen 警告）。
2. Secrets：`WINDOWS_CERTIFICATE`（pfx base64）、`WINDOWS_CERTIFICATE_PASSWORD`。
3. release.yml 的 Windows job 增加 `tauri.bundle.windows.certificateThumbprint` 配置与签名步骤。

## 校验产物完整性

Release 附带的文件可用 `shasum -a 256 <file>`（macOS）/ `Get-FileHash <file>`（Windows）比对；发布流程稳定后可增加 checksums.txt 自动生成。
