#!/usr/bin/env bash
# 单实例行为真机验证（macOS）：
#   首实例 A 运行中，带 .md 参数启动第二实例 B →
#   B 应快速自行退出（转交后），A 保持存活。
#
# 说明：转交后 A 的 UI 是否打开文档无法经 Accessibility API 读 WebView 内容验证，
# DOM 行为由 Mock E2E 与 mock-runtime IPC 测试覆盖；本脚本验证插件级单实例语义。

set -euo pipefail

BIN="${1:-src-tauri/target/release/marklook}"
DOC="${2:-tests/fixtures/pdf-check.md}"

if [[ ! -x "$BIN" ]]; then
  echo "错误：找不到可执行文件 $BIN（先运行 pnpm tauri build --bundles app）" >&2
  exit 1
fi
if [[ ! -f "$DOC" ]]; then
  echo "错误：测试文档不存在 $DOC" >&2
  exit 1
fi

pkill -x "$(basename "$BIN")" 2>/dev/null || true
sleep 0.5

"$BIN" >/dev/null 2>&1 &
A_PID=$!
sleep 2

if ! kill -0 "$A_PID" 2>/dev/null; then
  echo "✗ 首实例未能启动"
  exit 1
fi

echo "首实例 PID=$A_PID 已运行"

"$BIN" "$DOC" >/dev/null 2>&1 &
B_PID=$!

# B 应在 5s 内自行退出（单实例转交语义）。
B_EXITED=0
for _ in $(seq 50); do
  if ! kill -0 "$B_PID" 2>/dev/null; then
    B_EXITED=1
    break
  fi
  sleep 0.1
done

RESULT=0
if [[ "$B_EXITED" == "1" ]]; then
  wait "$B_PID" 2>/dev/null || true
  echo "✓ 第二实例已自行退出（单实例转交生效）"
else
  echo "✗ 第二实例 5s 后仍在运行（单实例未生效）"
  kill "$B_PID" 2>/dev/null || true
  RESULT=1
fi

if kill -0 "$A_PID" 2>/dev/null; then
  echo "✓ 首实例保持存活"
else
  echo "✗ 首实例意外退出"
  RESULT=1
fi

kill "$A_PID" 2>/dev/null || true
wait "$A_PID" 2>/dev/null || true
exit "$RESULT"
