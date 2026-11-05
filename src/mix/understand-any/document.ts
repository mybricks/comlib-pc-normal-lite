export type DiagramFile = { path: string; content: string };

export type DiagramMeta = {
  title?: string;
  summary?: string;
  bindingTo?: string;
};

function contentHash(content: string): number {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

export function reconcileDocuments(
  previous: DiagramFile[],
  next: DiagramFile[],
): DiagramFile[] {
  if (previous.length !== next.length) return next;
  const unchanged = previous.every((file, index) => {
    const incoming = next[index];
    return (
      file.path === incoming.path &&
      contentHash(file.content) === contentHash(incoming.content) &&
      file.content === incoming.content
    );
  });
  return unchanged ? previous : next;
}

export function parseMeta(content: string): DiagramMeta {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!frontmatter) return {};
  const read = (key: string) =>
    frontmatter
      .match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]
      ?.replace(/^['"]|['"]$/g, "")
      .trim();
  return {
    title: read("title"),
    summary: read("summary") ?? read("description"),
    bindingTo: read("bindingTo"),
  };
}

export function selectDocuments(
  files: DiagramFile[],
  bindingTo?: string,
): DiagramFile[] {
  return files.filter(
    (file) =>
      /```mermaid\s*\n/i.test(file.content) &&
      (!bindingTo || parseMeta(file.content).bindingTo === bindingTo),
  );
}

export function fileLabel(file: DiagramFile) {
  const meta = parseMeta(file.content);
  return (
    meta.title ?? file.path.split("/").pop()?.replace(/\.md$/i, "") ?? file.path
  );
}

export async function readDocuments(
  sandbox: any,
  dir: string,
): Promise<DiagramFile[]> {
  const prefix = `${dir}/docs/`;
  if (typeof sandbox?.getFiles === "function") {
    return (await sandbox.getFiles()).filter(
      (file: DiagramFile) =>
        file.path.replace(/^\.\//, "").startsWith(prefix) &&
        /\.md$/i.test(file.path),
    );
  }
  if (!sandbox?.files) return [];
  const entries = await sandbox.files.list(`${dir}/docs`, { recursive: true });
  const paths = entries
    .filter(
      (entry: any) =>
        entry.type !== "directory" &&
        entry.path.replace(/^\.\//, "").startsWith(prefix) &&
        /\.md$/i.test(entry.path),
    )
    .map((entry: any) => entry.path);
  return paths.length ? sandbox.files.readFiles(paths) : [];
}
