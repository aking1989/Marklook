#!/usr/bin/env bash
# 原生运行时冒烟（macOS）：启动 release 二进制（真实 TauriPlatform，非 Mock），
# 经 Accessibility API 断言窗口出现、标题正确、原生 UI 元素存在、干净退出。
#
# 说明：
# - WKWebView 的 HTML 内容对 System Events 不可穿透（那是 VoiceOver 运行时才暴露的
#   AX 树），DOM 级交互断言由 Mock 平台 E2E 覆盖；本脚本验证原生装配与窗口生命周期。
# - tauri-driver 不支持 macOS（仅 Windows/Linux），这是 macOS 原生冒烟的轻量替代。

set -euo pipefail

BIN="${1:-src-tauri/target/release/marklook}"

if [[ ! -x "$BIN" ]]; then
  echo "错误：找不到可执行文件 $BIN（先运行 pnpm tauri build --bundles app）" >&2
  exit 1
fi

exec python3 - "$BIN" <<'EOF'
import subprocess
import sys
import time

bin_path = sys.argv[1]
process_name = bin_path.rsplit("/", 1)[-1]

def osascript(script: str) -> str:
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        timeout=5,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "osascript 失败")
    return result.stdout.strip()

def window_ready() -> tuple[bool, str]:
    try:
        return True, osascript(
            f'tell application "System Events" to tell process "{process_name}" '
            'to get name of window 1'
        )
    except (RuntimeError, subprocess.TimeoutExpired):
        return False, ""

failures: list[str] = []
proc = subprocess.Popen(
    [bin_path],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

try:
    # 1. 窗口在 10s 内出现。
    deadline = time.monotonic() + 10
    title = ""
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            failures.append(f"进程提前退出（code={proc.returncode}）")
            break
        ready, title = window_ready()
        if ready:
            break
        time.sleep(0.1)
    else:
        failures.append("10s 内窗口未出现")

    # 2. 窗口标题 = tauri.conf.json 的 productName 配置标题。
    if not failures:
        if title != "墨览":
            failures.append(f"窗口标题期望「墨览」，实际「{title}」")
        else:
            print(f"✓ 窗口出现，标题「{title}」")

    # 3. 原生 UI 元素存在（窗口不是空壳）。
    if not failures:
        count = int(
            osascript(
                f'tell application "System Events" to tell process "{process_name}" '
                "to count UI elements of window 1"
            )
        )
        if count <= 0:
            failures.append("窗口无原生 UI 元素")
        else:
            print(f"✓ 原生 UI 元素 {count} 个")

    # 4. 进程稳定存活 1s（无启动即崩）。
    if not failures:
        time.sleep(1)
        if proc.poll() is not None:
            failures.append(f"启动 1s 内进程退出（code={proc.returncode}）")
        else:
            print("✓ 进程稳定运行")
finally:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)

if failures:
    for failure in failures:
        print(f"✗ {failure}")
    sys.exit(1)
print("✓ 原生冒烟通过")
EOF
