"""生成 Marklook 应用图标源图（1024x1024）。

设计：墨底（#16181B）+ 米白「墨」（#F5F1E8，Songti SC Bold），与 App 内
`.brand-mark`（深底浅字）一致。深底在 Windows 浅色任务栏、macOS 浅色 Dock 上
边界清楚；深色任务栏上底板会略融进背景，但白字仍清晰可读。

macOS 图标网格：1024 画布，圆角方块占 824x824 居中，圆角半径 185。

改完重跑本脚本，再生成全平台图标：

    python3 tools/generate-app-icon.py
    pnpm tauri icon design/icon-1024.png
"""
from PIL import Image, ImageDraw, ImageFont

S = 4                 # 超采样倍数
CANVAS = 1024
PLATE = 824
RADIUS = 185
FONT = "/System/Library/Fonts/Supplemental/Songti.ttc"

BG = (22, 24, 27)     # 墨底 #16181B
FG = (245, 241, 232)  # 米白 #F5F1E8

img = Image.new("RGBA", (CANVAS * S, CANVAS * S), (0, 0, 0, 0))
plate = Image.new("RGB", (PLATE * S, PLATE * S), BG)

f = ImageFont.truetype(FONT, 520 * S, index=1)  # Songti SC Bold
d = ImageDraw.Draw(plate)
l, t, r, b = d.textbbox((0, 0), "墨", font=f)
d.text(
    ((plate.width - (r - l)) / 2 - l, (plate.height - (b - t)) / 2 - t),
    "墨",
    font=f,
    fill=FG,
)

mask = Image.new("L", (PLATE * S, PLATE * S), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    [0, 0, PLATE * S - 1, PLATE * S - 1], radius=RADIUS * S, fill=255
)
img.paste(plate, ((CANVAS - PLATE) // 2 * S, (CANVAS - PLATE) // 2 * S), mask)
img.resize((CANVAS, CANVAS), Image.LANCZOS).save("design/icon-1024.png")
print("wrote design/icon-1024.png")
