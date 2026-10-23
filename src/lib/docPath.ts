/**
 * 文档路径工具：相对链接/图片的规范化解析。
 * 统一处理 POSIX 与 Windows 分隔符；结果始终为 POSIX 风格的绝对路径。
 */

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : ".";
  return normalized.slice(0, index);
}

/** 词法规范化：解析 `.` 与 `..` 段，不触碰文件系统；反斜杠统一为 POSIX 分隔符。 */
export function normalizeSegments(path: string): string {
  const unifiedPath = path.replace(/\\/g, "/");
  const isAbsolute = unifiedPath.startsWith("/");
  const parts: string[] = [];

  for (const segment of unifiedPath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!isAbsolute) {
        parts.push("..");
      }
      continue;
    }
    parts.push(segment);
  }

  const joined = parts.join("/");
  if (isAbsolute) return `/${joined}`;
  return joined || ".";
}

export function joinPath(baseDir: string, relative: string): string {
  if (relative.startsWith("/")) return normalizeSegments(relative);
  return normalizeSegments(`${baseDir}/${relative}`);
}

const MARKDOWN_EXTENSIONS = /\.(md|markdown|mdown|mkd)$/i;

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.test(path);
}

const EXTERNAL_PROTOCOL = /^(https?|mailto):/i;

export function isExternalUrl(url: string): boolean {
  return EXTERNAL_PROTOCOL.test(url);
}
