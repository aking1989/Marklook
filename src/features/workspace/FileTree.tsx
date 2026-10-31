import type { MouseEvent } from "react";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import type { TreeNode } from "../../stores/workspaceStore";

interface FileTreeProps {
  nodes: TreeNode[];
  expanded: Record<string, boolean>;
  activePath: string | null;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  /** 右键：由上层弹出菜单（在文件管理器中显示等）。 */
  onNodeContextMenu: (node: TreeNode, event: MouseEvent) => void;
}

export function FileTree({
  nodes,
  expanded,
  activePath,
  onToggleDir,
  onOpenFile,
  onNodeContextMenu,
}: FileTreeProps) {
  return (
    <ul className="file-tree" role="tree">
      {nodes.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          activePath={activePath}
          onToggleDir={onToggleDir}
          onOpenFile={onOpenFile}
          onNodeContextMenu={onNodeContextMenu}
        />
      ))}
    </ul>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  activePath: string | null;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onNodeContextMenu: (node: TreeNode, event: MouseEvent) => void;
}

function TreeRow({
  node,
  depth,
  expanded,
  activePath,
  onToggleDir,
  onOpenFile,
  onNodeContextMenu,
}: TreeRowProps) {
  const isOpen = expanded[node.path] ?? false;
  const isActive = node.path === activePath;

  if (node.isDir) {
    return (
      <li role="treeitem" aria-expanded={isOpen}>
        <button
          className={`tree-row${isActive ? " active" : ""}`}
          style={{ paddingLeft: depth * 12 + 6 }}
          onClick={() => onToggleDir(node.path)}
          onContextMenu={(event) => {
            event.preventDefault();
            onNodeContextMenu(node, event);
          }}
          title={node.path}
        >
          {isOpen ? (
            <ChevronDown size={13} className="tree-chevron" />
          ) : (
            <ChevronRight size={13} className="tree-chevron" />
          )}
          <Folder size={13} className="tree-icon" />
          <span className="tree-name">{node.name}</span>
        </button>
        {isOpen && node.children.length > 0 && (
          <ul role="group">
            {node.children.map((child) => (
              <TreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                activePath={activePath}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
                onNodeContextMenu={onNodeContextMenu}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li role="treeitem">
      <button
        className={`tree-row${isActive ? " active" : ""}`}
        style={{ paddingLeft: depth * 12 + 6 + 13 }}
        onClick={() => onOpenFile(node.path)}
        onContextMenu={(event) => {
          event.preventDefault();
          onNodeContextMenu(node, event);
        }}
        title={node.path}
      >
        <FileText size={13} className="tree-icon" />
        <span className="tree-name">{node.name}</span>
      </button>
    </li>
  );
}
