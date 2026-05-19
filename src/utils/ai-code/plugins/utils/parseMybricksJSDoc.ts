/**
 * 解析 @mybricks JSDoc 注释，将其中的 YAML 风格内容转换为结构化数据。
 *
 * 支持的格式（参考样例）：
 * ```
 * /**
 *  * @mybricks
 *  * name: LoginForm
 *  * title: 登录表单区块
 *  * summary: 包含用户名、密码输入框及登录按鈕
 *  * type: com
 *  * datasource:
 *  *   loginBtn:
 *  *     login:
 *  *       desc: 调用登录接口
 *  * state:
 *  *   usernameInput:
 *  *     username:
 *  *       desc: 用户名输入值
 *  * events:
 *  *   userNameInput:
 *  *     onChange:
 *  *       title: 输入用户名
 *  *       mermaid: 'flowchart LR; A["..."]'
 *  *\/
 * ```
 */

export interface MybricksJSDoc {
  /** 组件 name（与声明变量名一致） */
  name?: string;
  /** 可读标题 */
  title?: string;
  /** 功能摘要 */
  summary?: string;
  /** 类型标识，如 "com" / "page" / "popup" */
  type?: string;
  /** state 绑定关系，嵌套 YAML 对象（className -> 字段名 -> 元信息） */
  state?: Record<string, any>;
  /** datasource 绑定关系，嵌套 YAML 对象 */
  datasource?: Record<string, any>;
  /** 事件描述，嵌套 YAML 对象 */
  events?: Record<string, any>;
  /** 其余未知顶层字段 */
  [key: string]: any;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

/** 去掉 JSDoc 块注释每行前缀 " * " 并 trim，返回纯文本行数组 */
function normalizeCommentLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd());
}

/** 计算一行的缩进级别（空格数） */
function getIndent(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === " ") count++;
    else break;
  }
  return count;
}

/**
 * 解析「从 startIdx 行开始、缩进 >= minIndent 的」行块，构建嵌套对象。
 *
 * 行格式：
 *   key:           → 纯对象键（后续缩进更深的行是值）
 *   key: value     → 标量键值对
 *   key: 'value'   → 带引号的标量（可能包含冒号）
 *
 * @returns [解析结果, 消费到的最后一行索引（不含）]
 */
function parseBlock(
  lines: string[],
  startIdx: number,
  minIndent: number
): [Record<string, any>, number] {
  const result: Record<string, any> = {};
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行 → 跳过
    if (!trimmed) {
      i++;
      continue;
    }

    const indent = getIndent(line);

    // 缩进小于本块最小缩进 → 退出当前块（回到上层）
    if (indent < minIndent) break;

    // 必须是 "key: ..." 或 "key:" 格式
    // 使用非贪婪匹配，支持 key 中包含 / 等字符（如 /store.js）
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      // 不是 key:value 格式，跳过
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const afterColon = trimmed.slice(colonIdx + 1); // 冒号后面部分（含前导空格）
    const valuePart = afterColon.trim();

    i++;

    // 判断是否有内联 value（支持单引号包裹的多词值）
    if (valuePart === "" || valuePart === undefined) {
      // 纯对象键，值由后续更深缩进的行构成
      if (i < lines.length) {
        const nextTrimmed = lines[i].trim();
        const nextIndent = nextTrimmed ? getIndent(lines[i]) : -1;
        if (nextIndent > indent) {
          const [child, nextI] = parseBlock(lines, i, nextIndent);
          result[key] = child;
          i = nextI;
        } else {
          result[key] = {};
        }
      } else {
        result[key] = {};
      }
    } else {
      // 有内联值：优先取带引号的字符串（单引号或双引号）
      const quotedMatch = valuePart.match(/^(['"])([\s\S]*)\1$/);
      if (quotedMatch) {
        result[key] = quotedMatch[2];
      } else {
        result[key] = valuePart;
      }
    }
  }

  return [result, i];
}

// ─── 主导出 ───────────────────────────────────────────────────────────────────

/**
 * 从 Babel CommentBlock 的 `.value`（注释中间部分）中解析 `@mybricks` JSDoc。
 *
 * 若注释中不包含 `@mybricks` 标记，返回 `null`。
 *
 * @param raw Babel CommentBlock.value，即 `/** ... *\/` 中间部分
 * @returns 解析出的 MybricksJSDoc 结构，或 null
 */
export function parseMybricksJSDoc(raw: string): MybricksJSDoc | null {
  if (raw == null || typeof raw !== "string") return null;

  const lines = normalizeCommentLines(raw);

  // 查找 @mybricks 标记行
  const mybricksIdx = lines.findIndex((l) => l.trim() === "@mybricks");
  if (mybricksIdx === -1) return null;

  // @mybricks 标记之后的行才是实际内容
  const contentLines = lines.slice(mybricksIdx + 1);

  // 找第一个非空行的缩进作为顶层最小缩进
  const firstNonEmpty = contentLines.find((l) => l.trim() !== "");
  if (!firstNonEmpty) return null;
  const topIndent = getIndent(firstNonEmpty);

  const [parsed] = parseBlock(contentLines, 0, topIndent);

  if (Object.keys(parsed).length === 0) return null;

  return parsed as MybricksJSDoc;
}
