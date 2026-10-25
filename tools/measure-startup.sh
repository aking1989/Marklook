#!/usr/bin/env bash
# 冷启动计时（macOS）：启动 release 二进制 → 轮询窗口出现 → 多次取中位数。
# 用法：tools/measure-startup.sh [二进制路径]（RUNS=N 环境变量改次数，默认 3）
#
# 全部计时在单个 python3 进程内完成（perf_counter 跨进程零点不一致，
# 旧版跨进程相减会出现负数）；窗口检测经 System Events（未授权时自动降级为
# 进程启动计时并在输出注明）。轮询粒度受 osascript 单次调用开销（约 30-80ms）限制，
# 结果为上限估计。

set -euo pipefail

BIN="${1:-src-tauri/target/release/marklook}"
RUNS="${RUNS:-3}"

if [[ ! -x "$BIN" ]]; then
  echo "错误：找不到可执行文件 $BIN（先运行 pnpm tauri build --bundles app）" >&2
  exit 1
fi

exec python3 - "$BIN" "$RUNS" <<'EOF'
import statistics
import subprocess
import sys
import time
from typing import Optional

bin_path = sys.argv[1]
runs = int(sys.argv[2])
process_name = bin_path.rsplit("/", 1)[-1]

def window_visible() -> bool:
    script = (
        'tell application "System Events" to tell process '
        f'"{process_name}" to exists window 1'
    )
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            timeout=2,
        )
    except subprocess.TimeoutExpired:
        return False
    return result.returncode == 0 and b"true" in result.stdout

def system_events_available() -> bool:
    """探测 System Events 可用性：不可用时 osascript 可能挂起等授权，须超时兜底。"""
    try:
        subprocess.run(
            ["osascript", "-e",
             'tell application "System Events" to count processes'],
            capture_output=True,
            timeout=3,
        )
    except subprocess.TimeoutExpired:
        return False
    return True

def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)

def measure_once(with_window_check: bool) -> Optional[float]:
    proc = subprocess.Popen(
        [bin_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    start = time.perf_counter_ns()
    deadline = start + 10_000_000_000  # 10s 超时
    try:
        while time.perf_counter_ns() < deadline:
            if proc.poll() is not None:
                return None  # 进程提前退出
            if with_window_check:
                if window_visible():
                    return (time.perf_counter_ns() - start) / 1_000_000
            else:
                # 降级：无 UI 检测手段，确认进程稳定存活 100ms 即视为启动成功，
                # 该数值只验证"能启动"，不代表 UI 就绪时间。
                time.sleep(0.1)
                if proc.poll() is None:
                    return (time.perf_counter_ns() - start) / 1_000_000
            time.sleep(0.01)
        return None  # 超时
    finally:
        stop(proc)

# 探测一次检测方式。
window_check = system_events_available()
mode = (
    "窗口出现（System Events，粒度受 osascript 轮询开销限制，约 ±50ms）"
    if window_check
    else "进程存活 100ms（System Events 未授权：仅验证可启动，不代表 UI 就绪时间；"
         "请在交互终端重跑以获得窗口级计时）"
)

print(f"== 墨览冷启动计时（{runs} 次）==")
print(f"检测方式：{mode}")

# 预热一次（磁盘缓存），不计入。
warmup = subprocess.Popen(
    [bin_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
)
time.sleep(1.5)
stop(warmup)
time.sleep(0.5)

values: list[float] = []
for index in range(runs):
    elapsed = measure_once(window_check)
    if elapsed is None:
        print(f"第 {index + 1} 次：失败（超时或进程提前退出）")
        continue
    values.append(elapsed)
    print(f"第 {index + 1} 次：{elapsed:.0f} ms")

if values:
    median = statistics.median(values)
    budget = 1000
    verdict = "达标" if median < budget else "超出预算"
    print(f"中位数：{median:.0f} ms（预算：macOS < {budget} ms，{verdict}）")
else:
    print("无有效样本")
    sys.exit(1)
EOF
