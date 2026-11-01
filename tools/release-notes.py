#!/usr/bin/env python3
"""从 CHANGELOG.md 提取指定版本的正文，作为 GitHub Release 的说明。

发布说明只认 CHANGELOG 里人工写好的段落——不用 `gh release create --generate-notes`，
那是按 commit 自动拼的，对用户没有可读性。

用法：
    python3 tools/release-notes.py 0.10.3 > notes.md
    python3 tools/release-notes.py v0.10.3 --changelog CHANGELOG.md

找不到该版本时以非零码退出（让 CI 直接失败，而不是悄悄发布一份空说明）。
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

HEADING = re.compile(r"^##\s+\[(?P<version>[^\]]+)\]")


def extract(changelog: str, version: str) -> str:
    lines = changelog.splitlines()
    start: int | None = None

    for index, line in enumerate(lines):
        match = HEADING.match(line)
        if match and match.group("version").lstrip("v") == version.lstrip("v"):
            start = index + 1
            break

    if start is None:
        raise SystemExit(
            f"CHANGELOG.md 里找不到版本 {version} 的段落（## [{version}]）"
        )

    end = len(lines)
    for index in range(start, len(lines)):
        if HEADING.match(lines[index]):
            end = index
            break

    body = "\n".join(lines[start:end]).strip()
    if not body:
        raise SystemExit(f"版本 {version} 的段落是空的，先补 CHANGELOG 再发布")
    return body


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="版本号，可带 v 前缀")
    parser.add_argument(
        "--changelog",
        default="CHANGELOG.md",
        help="CHANGELOG 路径（默认 CHANGELOG.md）",
    )
    args = parser.parse_args()

    path = pathlib.Path(args.changelog)
    if not path.exists():
        print(f"找不到 {path}", file=sys.stderr)
        return 1

    sys.stdout.write(extract(path.read_text(encoding="utf-8"), args.version) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
