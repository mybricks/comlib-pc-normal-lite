/**
 * 将 files.json 形式的扁平文件列表转为目录树。
 * 每个节点均含 `fileName` 字段，表示该文件或目录的绝对路径（由 rootPrefix + 相对路径 规范化得到）。
 */

export type LowcodeFileRecord = {
  fileName: string;
  source?: string;
  compiled?: string;
  constituency?: unknown[];
  [key: string]: unknown;
};

export type FileTreeDirNode = {
  type: "directory";
  /** 目录名（路径最后一段） */
  name: string;
  /** 该目录的绝对路径 */
  fileName: string;
  children: FileTreeNode[];
};

export type FileTreeFileNode = LowcodeFileRecord & {
  type: "file";
  /** 展示用短名（文件名） */
  name: string;
  /** 该文件的绝对路径（覆盖原相对 fileName） */
  fileName: string;
};

export type FileTreeNode = FileTreeDirNode | FileTreeFileNode;

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

/** 将相对路径与根前缀拼成绝对路径；rootPrefix 为空时，结果为以 `/` 开头的虚拟绝对路径 */
export function toAbsoluteFileName(relativePath: string, rootPrefix = ""): string {
  const rel = normalizePath(relativePath).replace(/^\/+/, "");
  if (!rootPrefix) {
    return rel ? `/${rel}` : "/";
  }
  const base = normalizePath(rootPrefix).replace(/\/+$/, "");
  return rel ? `${base}/${rel}` : `${base}/`;
}

type DirTrie = {
  dirs: Map<string, DirTrie>;
  files: Map<string, LowcodeFileRecord>;
};

function insertFile(trie: DirTrie, segments: string[], file: LowcodeFileRecord): void {
  if (segments.length === 0) return;
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    trie.files.set(head, file);
    return;
  }
  let next = trie.dirs.get(head);
  if (!next) {
    next = { dirs: new Map(), files: new Map() };
    trie.dirs.set(head, next);
  }
  insertFile(next, rest, file);
}

function trieToNodes(
  trie: DirTrie,
  prefixSegments: string[],
  rootPrefix: string
): FileTreeNode[] {
  const nodes: FileTreeNode[] = [];

  const dirNames = [...trie.dirs.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of dirNames) {
    const sub = trie.dirs.get(name)!;
    const seg = [...prefixSegments, name];
    // const dirPath = toAbsoluteFileName(seg.join("/"), rootPrefix);
    const dirPath = seg.join("/")
    const children = trieToNodes(sub, seg, rootPrefix);
    nodes.push({
      type: "directory",
      name,
      fileName: dirPath,
      children,
    });
  }

  const fileNames = [...trie.files.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of fileNames) {
    const file = trie.files.get(name)!;
    const rel = String(file.fileName);
    // const abs = toAbsoluteFileName(rel, rootPrefix);
    const abs = rel;
    nodes.push({
      ...file,
      type: "file",
      name,
      fileName: abs,
    });
  }

  return nodes;
}

const rootTrie = (): DirTrie => ({ dirs: new Map(), files: new Map() });

/**
 * @param files - 与 files.json 相同的数组，每项含相对路径 `fileName`
 * @param rootPrefix - 可选根前缀（如 `file:///componentId` 或物理目录）；不传则 `fileName` 为以 `/` 开头的虚拟绝对路径
 */
export function filesJsonToTree(
  files: LowcodeFileRecord[],
  rootPrefix = ""
): FileTreeNode[] {
  const root = rootTrie();

  for (const file of files) {
    const rel = normalizePath(file.fileName).replace(/^\/+/, "");
    const segments = rel.split("/").filter(Boolean);
    insertFile(root, segments, file);
  }

  return trieToNodes(root, [], rootPrefix);
}
