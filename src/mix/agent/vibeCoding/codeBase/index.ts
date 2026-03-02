/**
 * CodeBase - 项目代码空间，供 ReAct Agent 使用
 * 支持 addFile、read、glob、grep，以及 exportToMessage 按「已读」区间导出
 */

export interface VirtualFile {
  path: string;
  getContent: () => string;
}

/** 已展开（已读）的行区间，按文件路径存储 */
type ExpandedRanges = Map<string, Array<{ start: number; end: number }>>;

const FOLD_HINT = (start: number, end: number) => `// ... L${start} - L${end} 内容未展开 ...`;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 合并重叠/相邻行区间 */
function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

/** 将 glob 模式转为正则（支持 * 与 **） */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export class CodeBase {
  private files = new Map<string, VirtualFile>();
  /** 每个路径下已通过 read 展开的行区间 */
  private expanded: ExpandedRanges = new Map();

  constructor() {}

  /**
   * 添加文件到代码库
   * @param path 文件路径，如 /runtime.jsx、/style.less
   * @param content 文件内容，或返回内容的函数（便于延迟求值）
   */
  addFile(path: string, content: string | (() => string)): void {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    this.files.set(normalized, {
      path: normalized,
      getContent: typeof content === 'function' ? content : () => content,
    });
  }

  /**
   * 标记某文件的某行区间为「已读」，exportToMessage 时会展开这些行
   * @param filePath 文件路径
   * @param offset 起始行（1-based），默认 1
   * @param limit 读取行数，不传则展开整个文件
   */
  read(filePath: string, options?: { offset?: number; limit?: number }): void {
    const path = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const file = this.files.get(path);
    if (!file) return;

    const content = file.getContent();
    const lines = content.split(/\r?\n/);
    const total = lines.length;
    if (total === 0) return;

    const offset = options?.offset ?? 1;
    const limit = options?.limit;
    const start = Math.max(1, offset);
    const end = limit != null ? Math.min(total, start + limit - 1) : total;

    const existing = this.expanded.get(path) ?? [];
    existing.push({ start, end });
    this.expanded.set(path, mergeRanges(existing));
  }

  /**
   * 按 glob 模式返回匹配的文件路径列表
   * 若 pattern 不含 /，则与路径的 basename 匹配（如 *.jsx 匹配 /runtime.jsx）
   */
  glob(pattern: string): string[] {
    const re = globToRegex(pattern);
    const hasSlash = pattern.includes('/');
    return Array.from(this.files.keys()).filter((p) => {
      const target = hasSlash ? p : p.replace(/^.*\//, '') || p;
      return re.test(target);
    });
  }

  /**
   * 在文件内容中按正则搜索
   * @param searchPattern 正则表达式字符串
   * @param fileFilter 可选，glob 模式过滤文件，如 "*.jsx"
   */
  grep(searchPattern: string, fileFilter?: string): Array<{ path: string; line: number; content: string }> {
    let paths = Array.from(this.files.keys());
    if (fileFilter) {
      const re = globToRegex(fileFilter);
      const hasSlash = fileFilter.includes('/');
      paths = paths.filter((p) => {
        const target = hasSlash ? p : p.replace(/^.*\//, '') || p;
        return re.test(target);
      });
    }
    const results: Array<{ path: string; line: number; content: string }> = [];
    for (const path of paths) {
      const file = this.files.get(path)!;
      const content = file.getContent();
      const lines = content.split(/\r?\n/);
      let re: RegExp;
      try {
        re = new RegExp(searchPattern, 'i');
      } catch {
        re = new RegExp(escapeRegex(searchPattern), 'i');
      }
      lines.forEach((line, i) => {
        if (re.test(line)) results.push({ path, line: i + 1, content: line });
      });
    }
    return results;
  }

  /**
   * 导出为给 Agent 的 message 文本：按文件名区分，仅已 read 的区间展示内容，未读部分用「Lx - Ly 内容未展开」占位
   */
  exportToMessage(): string {
    const parts: string[] = ['## 项目空间\n', '\n 项目空间是项目中的所有代码，聚焦信息中的组件属于整个项目里的部分组件，可以通过grep先定位位置。\n\n'];
    const sortedPaths = Array.from(this.files.keys()).sort();

    for (const path of sortedPaths) {
      const file = this.files.get(path)!;
      const content = file.getContent();
      const ranges = this.expanded.get(path) ?? [];
      const fileName = path.replace(/^\//, '') || path;

      parts.push(`### ${fileName}\n-----\n`);
      parts.push(this.buildFileSection(content, ranges));
      parts.push('\n-----\n\n');
    }

    return parts.join('');
  }

  private buildFileSection(fullContent: string, expandedRanges: Array<{ start: number; end: number }>): string {
    const lines = fullContent.split(/\r?\n/);
    const total = lines.length;
    if (total === 0) return '(空文件)\n';

    const merged = mergeRanges(expandedRanges);
    const bodyParts: string[] = [];
    let lastEnd = 0;

    if (merged.length === 0) {
      bodyParts.push(FOLD_HINT(1, total));
    } else {
      for (const r of merged) {
        const start = Math.max(1, r.start);
        const end = Math.min(total, r.end);
        if (start > lastEnd + 1) {
          bodyParts.push(FOLD_HINT(lastEnd + 1, start - 1));
        }
        bodyParts.push(lines.slice(start - 1, end).join('\n'));
        lastEnd = end;
      }
      if (lastEnd < total) {
        bodyParts.push(FOLD_HINT(lastEnd + 1, total));
      }
    }

    return bodyParts.join('\n\n') + '\n';
  }

  /** 获取当前所有文件路径 */
  getFilePaths(): string[] {
    return Array.from(this.files.keys());
  }

  /** 获取某路径的完整内容（不依赖 read 状态） */
  getFileContent(path: string): string | null {
    const p = path.startsWith('/') ? path : `/${path}`;
    const file = this.files.get(p);
    return file ? file.getContent() : null;
  }
}

export default CodeBase;
