#!/usr/bin/env bash
# 冷启动计时（macOS）：启动 release 二进制 → 轮询窗口出现 → 3 次取中位数。
# 用法：tools/measure-startup.sh [二进制路径]
#
# 说明：窗口出现检测用 System Events（osascript）。若本会话未获得
# 「控制 System Events」授权，自动降级为进程启动计时（不含 UI 渲染）并在输出中注明。

set -euo pipefail

BIN="${1:-src-tauri/target/release/marklook}"
RUNS="${RUNS:-3}"
APP_NAME="marklook"

if [[ ! -x "$BIN" ]]; then
  echo "错误：找不到可执行文件 $BIN（先运行 pnpm tauri build --bundles app）" >&2
  exit 1
fi

# 检测 System Events 是否可用：带 3 秒超时（无授权时 osascript 会挂起等弹窗）。
WINDOW_CHECK_OK=0
if command -v gtimeout >/dev/null 2>&1; then
  gtimeout 3 osascript -e 'tell application "System Events" to count processes' >/dev/null 2>&1 && WINDOW_CHECK_OK=1
else
  # macOS 无 gtimeout：用后台 perl 哨兵兜底（3 秒后杀掉 osascript）。
  if (osascript -e 'tell application "System Events" to count processes' >/dev/null 2>&1 &
    pid=$!; (sleep 3; kill $pid 2>/dev/null) & wait $pid); then
    WINDOW_CHECK_OK=1
  fi
fi

measure_once() {
  local start_ns end_ms
  start_ns=$(python3 -c 'import time; print(time.perf_counter_ns())')

  "$BIN" & local pid=$!

  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [[ "$WINDOW_CHECK_OK" == "1" ]]; then
      if osascript -e "tell application \"System Events\" to tell process \"$APP_NAME\" to exists window 1" 2>/dev/null | grep -q true; then
        break
      fi
    else
      # 降级：进程存活即视为启动（不测 UI）。
      sleep 0.05
      break
    fi
    sleep 0.02
    waited=$((waited + 1))
    if [[ $waited -gt 500 ]]; then break; fi # 10s 超时
  done

  end_ns=$(python3 -c 'import time; print(time.perf_counter_ns())')
  python3 -c "print(($end_ns - $start_ns) / 1_000_000)"
}

echo "== 墨览冷启动计时（$RUNS 次）=="
if [[ "$WINDOW_CHECK_OK" == "1" ]]; then
  echo "检测方式：窗口出现（System Events）"
else
  echo "检测方式：进程启动（System Events 未授权，不含 UI 渲染时间）"
fi

# 预热一次（磁盘缓存），不计入。
"$BIN" >/dev/null 2>&1 & sleep 1.5; pkill -x "$APP_NAME" 2>/dev/null || true; sleep 0.5

results=()
for _ in $(seq "$RUNS"); do
  ms=$(measure_once)
  results+=("$ms")
  printf '第 %d 次：%s ms\n' "${#results[@]}" "$(python3 -c "print(f'{$ms:.0f}')")"
  pkill -x "$APP_NAME" 2>/dev/null || true
  sleep 0.5
done

python3 - "${results[@]}" <<'EOF'
import statistics, sys
values = [float(v) for v in sys.argv[1:]]
print(f"中位数：{statistics.median(values):.0f} ms（预算：macOS < 1000 ms）")
EOF
