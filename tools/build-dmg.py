#!/usr/bin/env python3
"""从 Marklook.app 制作带引导背景的 dmg（设计：dmg 安装窗口加引导背景）。

替代 Tauri 自带的 bundle_dmg.sh：后者依赖 AppleScript 控制 Finder，
在 GitHub Actions 无头 runner 上不会真正执行（不写 .DS_Store，背景失效）。
dmgbuild 纯 Python 写 .DS_Store，无 GUI 依赖，CI 与本地行为一致。

用法：
  tools/build-dmg.py <Marklook.app 路径> <输出 dmg 路径> <背景图路径> <版本号>
"""
import subprocess
import sys
import tempfile
from pathlib import Path

if len(sys.argv) < 5:
    print(__doc__)
    sys.exit(1)

APP_PATH = Path(sys.argv[1]).resolve()
OUTPUT = Path(sys.argv[2]).resolve()
BACKGROUND = Path(sys.argv[3]).resolve()
VERSION = sys.argv[4]

# 与 tauri.conf.json bundle.macOS.dmg 的既有定位一致（660x400 窗口，Retina 2x 背景图）。
WINDOW_RECT = ((0, 0), (660, 400))
APP_POS = (180, 170)
FOLDER_POS = (480, 170)
# 必须是 128：背景图里的箭头端点是按 128pt 图标量出来的（见
# tools/generate-dmg-background.py 注释）。改成 96 会让箭头两端各脱开约 17pt。
ICON_SIZE = 128

settings = f'''# -*- coding: utf-8 -*-
from pathlib import Path

format = "UDZO"
compress_type = "zlib"

files = [{str(APP_PATH)!r}]
symlinks = {{"Applications": "/Applications"}}

background = {str(BACKGROUND)!r}
window_rect = {WINDOW_RECT!r}
default_view = "icon-view"
show_icon_preview = False

icon_size = {ICON_SIZE}
text_size = 13
icon_locations = {{
    "Marklook.app": {APP_POS!r},
    "Applications": {FOLDER_POS!r},
}}
'''

if not APP_PATH.exists():
    print(f"错误：找不到 {APP_PATH}", file=sys.stderr)
    sys.exit(1)
if not BACKGROUND.exists():
    print(f"错误：找不到背景图 {BACKGROUND}", file=sys.stderr)
    sys.exit(1)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
    f.write(settings)
    settings_path = f.name

subprocess.run(
    [
        sys.executable, "-m", "dmgbuild",
        "-s", settings_path,
        f"Marklook {VERSION}",
        str(OUTPUT),
    ],
    check=True,
)
print(f"OK: {OUTPUT}")
