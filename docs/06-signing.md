# 代码签名与分发说明

墨览（Marklook）v1.x 阶段**不做强制签名**：安装包由 GitHub Actions 构建（见 `.github/workflows/release.yml`），个人使用可直接下载。

## 现状

| 平台 | 产物 | 签名状态 | 用户影响 |
| --- | --- | --- | --- |
| macOS | `.dmg` / `.app.tar.gz`（universal） | 仅 ad-hoc 签名、未公证 | 首次打开被 Gatekeeper 拦一次（见下节） |
| Windows | NSIS `.exe` 安装包 | 未签名 | SmartScreen 提示"未知发布者"，选"仍要运行" |

## macOS 首次打开：为什么打不开

未公证的 App 从网络下载后带 `com.apple.quarantine` 扩展属性，Gatekeeper 会弹
「Apple 无法验证"Marklook"是否包含可能危害 Mac 安全或泄漏隐私的恶意软件」，
弹窗**只有「完成 / 移到废纸篓」两个按钮**。

这是系统策略拦截，不是安装包损坏，二进制本身可以正常运行。三种解法：

1. **终端（最快）**：

   ```bash
   xattr -dr com.apple.quarantine /Applications/Marklook.app
   open /Applications/Marklook.app
   ```

2. **系统设置**：打开「系统设置 → 隐私与安全性」，滚到底部「安全性」区域，
   在「已阻止使用"Marklook"」处点「仍要打开」，再输入登录密码。

3. **从挂载镜像直接拖出**：`hdiutil attach Marklook_x.y.z_universal.dmg`，把 `.app` 拖到
   `/Applications`——仍然带隔离属性，仍需 1 或 2。

> macOS 15（Sequoia）起「右键 → 打开」的旧绕过方式**已失效**：右键打开同样只弹上述两个按钮，
> 这也是旧版 README 指引失效、用户卡住的原因。

### 为什么"上个版本能装，这个版本不行"

经常收到这种反馈，但**不是新版本变差了**。以 v0.9.2 → v0.10.0 为例，两个 tag 之间
`.github/workflows/release.yml`、`pnpm-lock.yaml`（`@tauri-apps/cli` 固定 2.12.4）、
`tauri.conf.json` 的打包相关字段全部没有变化，只有版本号不同——两个 dmg 的签名状态完全一致
（都只有 ad-hoc 签名，都没公证）。真正的差异在系统侧，常见三种：

1. **下载途径不同**。浏览器下载会给文件打 `com.apple.quarantine`；`curl`、迅雷、部分网盘客户端、
   AirDrop/微信传输往往不打。没打标记的包双击就能开，看起来"这个版本可以直接装"。
2. **放行记录按二进制指纹缓存**。在「隐私与安全性 → 仍要打开」放行过一次，只对当时那个构建有效；
   重新打包后 cdhash 变了，系统会再拦一次。
3. **系统升级过**。macOS 14 及更早的拦截弹窗带「打开」按钮，点一下即可；15 起按钮被移除，
   只能走系统设置或 `xattr`。升级前后同一个包，体验完全不同。

自查命令：

```bash
xattr -l /Applications/Marklook.app        # 有 com.apple.quarantine 就是被隔离了
codesign -dv /Applications/Marklook.app     # 看签名类型（adhoc 还是 Developer ID）
spctl -a -vvv /Applications/Marklook.app    # 看 Gatekeeper 评估结论
```

只有配好 Developer ID 证书做公证，才能让每个新版本都双击直接打开。

## 彻底消除提示：Developer ID 签名 + 公证

需要 Apple Developer Program（$99/年）。CI 已内置开关：**只要配好下面 6 个 Secrets，
下一次打 `v*` tag 就会自动签名、公证并 staple**，无需改代码。

1. 本机确认证书存在：`security find-identity -v -p codesigning`（需 "Developer ID Application"）。
2. 导出 `.p12` 并转 base64：`base64 -i cert.p12 | pbcopy`。
3. 在仓库 Settings → Secrets and variables → Actions 添加：

   | Secret | 内容 |
   | --- | --- |
   | `APPLE_CERTIFICATE` | `.p12` 的 base64 |
   | `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设的密码 |
   | `APPLE_SIGNING_IDENTITY` | 如 `Developer ID Application: Your Name (TEAMID)` |
   | `APPLE_ID` | Apple 账号邮箱 |
   | `APPLE_PASSWORD` | App 专用密码（appleid.apple.com 生成，非登录密码） |
   | `APPLE_TEAM_ID` | 10 位 Team ID |

4. 打 tag 触发 release，`Verify signature` 步骤会跑 `codesign --verify`、`spctl --assess`
   与 `stapler validate`，任一项不通过会在日志里显示。

未配置 `APPLE_CERTIFICATE` 时，工作流走「unsigned, ad-hoc」分支，与之前行为一致，不会因缺 Secret 失败。

## Windows 签名（可选）

1. 购买 OV/EV 代码签名证书（EV 可立即消除 SmartScreen 警告）。
2. Secrets：`WINDOWS_CERTIFICATE`（pfx base64）、`WINDOWS_CERTIFICATE_PASSWORD`。
3. release.yml 的 Windows job 增加证书导入与 `bundle.windows.certificateThumbprint` 配置。

## 校验产物完整性

Release 附带的文件可用 `shasum -a 256 <file>`（macOS）/ `Get-FileHash <file>`（Windows）比对；
发布流程会自动生成 `SHA256SUMS.txt`。
