/**
 * 基于 before / after 的文本替换工具，用于文件内容片段的匹配与修改。
 *
 * ## before / after 语义
 *
 * - **替换**：before 非空 且 after 非空 → 在内容中查找与 before 匹配的片段，改为 after。
 * - **新增**：before 为空 且 after 非空 → 整段内容视为由 after 覆盖（常用于新建或整文件替换）。
 * - **删除**：before 非空 且 after 为空 → 在内容中查找与 before 匹配的片段并删除。
 *
 * 匹配采用多策略链（精确 → 行 trim → 首尾行锚点 → 空格归一化），无三方依赖；
 * 可通过 registerReplacer 注册依赖三方库的扩展策略。
 */

/** 返回在 content 中匹配 find 的片段列表（每个元素为 content 中的一段子串） */
export type Replacer = (content: string, find: string) => string[];

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

function levenshtein(a: string, b: string): number {
  if (a === '' || b === '') return Math.max(a.length, b.length);
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function simpleReplacer(content: string, find: string): string[] {
  if (find === '' || !content.includes(find)) return [];
  return [find];
}

function lineTrimmedReplacer(content: string, find: string): string[] {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();

  const out: string[] = [];
  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false;
        break;
      }
    }
    if (matches) {
      let start = 0;
      for (let k = 0; k < i; k++) start += originalLines[k].length + 1;
      let end = start;
      for (let k = 0; k < searchLines.length; k++) {
        end += originalLines[i + k].length + (k < searchLines.length - 1 ? 1 : 0);
      }
      out.push(content.substring(start, end));
    }
  }
  return out;
}

function blockAnchorReplacer(content: string, find: string): string[] {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines.length < 3) return [];
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();

  const firstLineSearch = searchLines[0].trim();
  const lastLineSearch = searchLines[searchLines.length - 1].trim();
  const searchBlockSize = searchLines.length;

  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) continue;
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break;
      }
    }
  }

  if (candidates.length === 0) return [];

  const getBlock = (startLine: number, endLine: number) => {
    let start = 0;
    for (let k = 0; k < startLine; k++) start += originalLines[k].length + 1;
    let endIdx = start;
    for (let k = startLine; k <= endLine; k++) {
      endIdx += originalLines[k].length + (k < endLine ? 1 : 0);
    }
    return content.substring(start, endIdx);
  };

  const calcSimilarity = (startLine: number, endLine: number) => {
    const actualBlockSize = endLine - startLine + 1;
    let similarity = 0;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);
    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const orig = originalLines[startLine + j].trim();
        const search = searchLines[j].trim();
        const maxLen = Math.max(orig.length, search.length);
        if (maxLen === 0) continue;
        similarity += 1 - levenshtein(orig, search) / maxLen;
      }
      similarity /= linesToCheck;
    } else {
      similarity = 1.0;
    }
    return similarity;
  };

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    if (calcSimilarity(startLine, endLine) >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      return [getBlock(startLine, endLine)];
    }
    return [];
  }

  let best: { startLine: number; endLine: number } | null = null;
  let maxSim = -1;
  for (const c of candidates) {
    const sim = calcSimilarity(c.startLine, c.endLine);
    if (sim > maxSim) {
      maxSim = sim;
      best = c;
    }
  }
  if (maxSim >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && best) {
    return [getBlock(best.startLine, best.endLine)];
  }
  return [];
}

function whitespaceNormalizedReplacer(content: string, find: string): string[] {
  const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
  const normalizedFind = normalize(find);
  const out: string[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (normalize(lines[i]) === normalizedFind) {
      out.push(lines[i]);
    }
  }
  const findLines = find.split('\n');
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length).join('\n');
      if (normalize(block) === normalizedFind) out.push(block);
    }
  }
  return out;
}

const BUILTIN_REPLACERS: Array<{ name: string; fn: Replacer }> = [
  { name: 'exact', fn: simpleReplacer },
  { name: 'lineTrimmed', fn: lineTrimmedReplacer },
  { name: 'blockAnchor', fn: blockAnchorReplacer },
  { name: 'whitespaceNormalized', fn: whitespaceNormalizedReplacer },
];

const EXTRA_REPLACERS: Array<{ name: string; fn: Replacer }> = [];

/** 注册额外匹配策略（如依赖三方库的模糊匹配），在内置策略之后尝试。 */
export function registerReplacer(name: string, fn: Replacer): void {
  EXTRA_REPLACERS.push({ name, fn });
}

function getAllReplacers(): Array<{ name: string; fn: Replacer }> {
  return [...BUILTIN_REPLACERS, ...EXTRA_REPLACERS];
}

/** 单次替换结果；strategy 为命中的匹配策略名，便于调试与上层展示。 */
export interface ReplaceResult {
  ok: boolean;
  newContent?: string;
  strategy?: string;
  error?: 'NOT_FOUND' | 'MULTIPLE_MATCH' | 'NO_CHANGE';
  message?: string;
}

/**
 * 单次替换：在文件内容中根据 before / after 做一次替换/新增/删除。
 * @param content 当前文件内容
 * @param before 要匹配的片段（空表示新增：整段用 after 覆盖）
 * @param after 替换后的内容（空表示删除：在内容中删除匹配 before 的片段）
 */
export function replaceFile(content: string, before: string, after: string): ReplaceResult {
  if (before === after) {
    return { ok: false, error: 'NO_CHANGE', message: 'before 与 after 相同，无需替换' };
  }

  // 新增：before 空、after 非空 → 整段内容设为 after
  if (before === '') {
    return { ok: true, newContent: after, strategy: 'insert' };
  }

  // 删除 / 替换：在 content 中查找 before，替换为 after（after 空即删除）
  let foundMultiple = false;
  for (const { name, fn } of getAllReplacers()) {
    const matches = fn(content, before);
    for (const search of matches) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) {
        foundMultiple = true;
        continue;
      }
      const newContent =
        content.substring(0, index) + after + content.substring(index + search.length);
      return { ok: true, newContent, strategy: name };
    }
  }

  if (foundMultiple) {
    return {
      ok: false,
      error: 'MULTIPLE_MATCH',
      message: 'before 在文件中出现多次，请提供更多上下文使匹配唯一',
    };
  }
  return {
    ok: false,
    error: 'NOT_FOUND',
    message: '未在文件中找到 before 片段，请确认与当前文件内容一致（含空格、缩进、换行）',
  };
}

/** 多步替换中每一步的结果项（与 ReplaceResult 对齐，便于上层汇总展示） */
export interface ReplaceResultItem {
  ok: boolean;
  strategy?: string;
  error?: 'NOT_FOUND' | 'MULTIPLE_MATCH' | 'NO_CHANGE';
  message?: string;
}

/** 多次替换的总体结果；仅当全部步骤成功时 newContent 有效。 */
export interface MultiReplaceResult {
  ok: boolean;
  newContent?: string;
  results: ReplaceResultItem[];
}

/**
 * 多次替换：按顺序对 content 执行多组 before/after；任一步失败则中止，不写回。
 * @param content 当前文件内容
 * @param operations 按顺序执行的 { before, after } 列表
 */
export function multiReplaceFile(
  content: string,
  operations: Array<{ before: string; after: string }>
): MultiReplaceResult {
  const results: ReplaceResultItem[] = [];
  let current = content;

  for (const { before, after } of operations) {
    const result = replaceFile(current, before, after);
    results.push({
      ok: result.ok,
      strategy: result.strategy,
      error: result.error,
      message: result.message,
    });
    if (!result.ok || result.newContent === undefined) {
      return { ok: false, results };
    }
    current = result.newContent;
  }

  return { ok: true, newContent: current, results };
}
