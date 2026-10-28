"""生成 macOS DMG 安装引导背景图。

Tauri 通过 bundle.macOS.dmg.background 引用此 PNG，图标位置由
appPosition / applicationFolderPosition 决定——**它们是图标中心点**，
不是左上角（实测：窗口 660x400，图标中心落在 (180,170) 与 (480,170)）。

注意：DMG 窗口的 660x400 含标题栏，macOS 26 上标题栏约 39pt，
内容区只有 ~361pt。所以背景按 660x400 画，但**所有内容必须落在
顶部 ~350pt 内**，底部留给裁切。
"""
import math

from PIL import Image, ImageDraw, ImageFont

W, H = 660, 400
BG = (247, 247, 248)          # 与 Marklook --bg-elevated 一致
FG = (31, 35, 40)             # --fg
MUTED = (101, 109, 118)       # --fg-muted
ACCENT = (9, 105, 218)        # --accent

FONT_CN = "/System/Library/Fonts/Hiragino Sans GB.ttc"

# 输出 2 倍像素 + 144 DPI 元数据：Finder 按 DPI 换算成 660x400 点显示，
# Retina 屏上才是清晰的；只给 1x 图会被放大成糊的。
SCALE = 2
# 再叠 3 倍超采样：PIL 不做抗锯齿，线条和文字边缘需要缩采样才平滑。
SS = SCALE * 3
img = Image.new("RGB", (W * SS, H * SS), BG)
d = ImageDraw.Draw(img)

# 图标格子中心：tauri.conf.json 的 appPosition=(180,170)、applicationFolderPosition=(480,170)
# 是图标**中心点**。本脚本内部一律乘 SS 换算到超采样像素。

# 顶部标题
title = ImageFont.truetype(FONT_CN, 23 * SS)
line = "将 Marklook 拖入 Applications 文件夹"
tw = d.textlength(line, font=title)
d.text(((W * SS - tw) / 2, 58 * SS), line, font=title, fill=FG)

# 连接箭头：水平直线。
# 端点按**打出来的 dmg 里实测**的图标可见边缘定（不是 128pt 格子边界）：
# 应用图标可见右缘 233、Applications 可见左缘 418，两者视觉中心 171.25 / 175。
# 两端各留 3pt，箭头才像"接着"两个图标；垂直取两者中点 172。
AX1, AX2 = 236, 415
AY = 172

# 箭头头部：等腰三角，尖端在 AX2。
# 线段必须止于三角底边——画到尖端的话，4.5pt 的线宽比尖端宽，
# 会从三角斜边里戳出一条矩形"鼻子"，箭头看着就钝了。
HEAD = 16
SPREAD = math.radians(30)
base_x = AX2 - HEAD * math.cos(SPREAD)
half_h = HEAD * math.sin(SPREAD)

d.line(
    [(AX1 * SS, AY * SS), (base_x * SS, AY * SS)],
    fill=ACCENT,
    width=round(4.5 * SS),
)
d.polygon(
    [
        (AX2 * SS, AY * SS),
        (base_x * SS, (AY - half_h) * SS),
        (base_x * SS, (AY + half_h) * SS),
    ],
    fill=ACCENT,
)

# 底部操作提示（保持在安全区内）
foot = ImageFont.truetype(FONT_CN, 13 * SS)
foot_line = "首次打开：系统设置 → 隐私与安全性 → 仍要打开"
fw = d.textlength(foot_line, font=foot)
d.text(((W * SS - fw) / 2, 318 * SS), foot_line, font=foot, fill=MUTED)

img = img.resize((W * SCALE, H * SCALE), Image.LANCZOS)

out = "src-tauri/icons/dmg-background.png"
img.save(out, "PNG", optimize=True, dpi=(72 * SCALE, 72 * SCALE))
print(f"wrote {out} {img.size} @{72 * SCALE}dpi")
