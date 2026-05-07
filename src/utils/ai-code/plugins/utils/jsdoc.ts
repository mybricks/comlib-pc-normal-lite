/**
 * 把 JSDoc 注释的「原始字符串」解析成结构化数据：summary + props 数组 + events 数组。
 *
 * 入参 raw：Babel 里 CommentBlock 的 .value（块注释中间部分，每行可能带前导 " * "）。
 *
 * 支持的写法示例：
 *   @summary 主按钮
 *   @prop 加 type 时：{string} text - 按钮内容
 *   @param 加 type 时：{number} count - 数量（@param 与 @prop 都会收集到 props）
 *   @event：{事件key} 事件名 - 描述（如 Mermaid 流程图）
 *
 * 返回：{ summary?, props?, events? }；若既没有 summary 也没有任何 prop 也没有任何 event 则返回 null。
 */
export function parseJSDocComment(raw: string): { summary?: string; props?: Array<{ type?: string; name: string; description?: string }>; events?: Array<{ key: string; name?: string; description?: string }> } | null {
  if (raw == null || typeof raw !== "string") return null;
  // 按行分割，并去掉每行前面的 " * " 或 "* "，方便后面用正则匹配
  const lines = raw.split(/\r?\n/).map((s) => s.replace(/^\s*\*\s?/, "").trim());
  let summary: string | undefined;
  const props: Array<{ type?: string; name: string; description?: string }> = [];
  const events: Array<{ key: string; name?: string; description?: string }> = [];

  for (const line of lines) {
    const summaryMatch = line.match(/^@summary\s+(.+)$/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      continue;
    }
    // @prop / @param：可选 {type}，必填 name，可选 "- 描述"
    const propMatch = line.match(/^@(?:prop|param)\s+(?:\{([^}]*)\}\s+)?(\S+)(?:\s+-\s+(.+))?$/);
    if (propMatch) {
      props.push({
        type: propMatch[1]?.trim() || undefined,
        name: propMatch[2].trim(),
        description: propMatch[3]?.trim() || undefined,
      });
      continue;
    }
    // @event：必填 {事件key}，事件名，可选 " - 描述"（与 @prop 处理方式一致）
    const eventMatch = line.match(/^@event\s+\{([^}]*)\}\s+(.+)$/);
    if (eventMatch) {
      const key = eventMatch[1].trim();
      const rest = eventMatch[2].trim();
      const dashIdx = rest.indexOf(" - ");
      const name = dashIdx >= 0 ? rest.slice(0, dashIdx).trim() : rest;
      const description = dashIdx >= 0 ? rest.slice(dashIdx + 3).trim() : undefined;
      events.push({ key, name: name || undefined, description });
    }
  }

  if (!summary && props.length === 0 && events.length === 0) return null;
  const result: any = { summary };
  if (props.length) {
    result.props = props;
  }
  if (events.length) {
    result.events = events;
  }
  return result;
}

/** 匹配注释中的「属性名:处理函数名」，提取冒号后的 handler 名（排除datasource） */
const EVENT_COMMENT_REGEX = /\b(?!datasource\b)(\w+)\s*:\s*(\w+)\b/g;

function extractHandlerNamesFromCommentValue(value: string): string[] {
  if (value == null || typeof value !== "string") return [];
  const normalized = value.replace(/\s*\*\s?/g, " ").trim();
  const names: string[] = [];
  let m;
  EVENT_COMMENT_REGEX.lastIndex = 0;
  while ((m = EVENT_COMMENT_REGEX.exec(normalized)) !== null) {
    // m[1]是属性名（如onClick），m[2]是handler名（如primaryClick）
    names.push(m[2]);
  }
  return names;
}

/**
 * 遍历 openingElement.attributes，从各属性的 leadingComments / trailingComments 中
 * 解析形如 /** onClick:primaryClick *\/ 的注释（提取events）和 
 * /** datasource:studentListApi *\/ 的注释（提取datasource）。
 * events会去重，datasource只取第一个匹配到的值。
 */
export function parseJSXComments(node: {
  openingElement?: { 
    attributes?: Array<{ 
      leadingComments?: Array<{ value?: string }>; 
      trailingComments?: Array<{ value?: string }> 
    }> 
  } 
}): { 
  events: string[]; 
  datasource?: string;
} {
  const eventNames = new Set<string>();
  let datasourceKey: string | undefined;
  const attrs = node.openingElement?.attributes ?? [];
  
  for (const attribute of attrs) {
    const comments = [
      ...(attribute.leadingComments ?? []),
      ...(attribute.trailingComments ?? []),
    ];
    for (const comment of comments) {
      const value = comment.value ?? "";
      // 提取events（排除datasource）
      const names = extractHandlerNamesFromCommentValue(value);
      names.forEach((name) => eventNames.add(name));
      
      // 提取datasource（只取第一个）
      if (!datasourceKey) {
        datasourceKey = extractDatasourceFromCommentValue(value);
      }
    }
  }
  
  return {
    events: Array.from(eventNames),
    datasource: datasourceKey,
  };
}

/** 匹配 datasource:xxx 格式的注释 */
const DATASOURCE_COMMENT_REGEX = /^\s*datasource\s*:\s*(\w+)\s*$/;

/** 从注释value中提取datasource的key */
function extractDatasourceFromCommentValue(value: string): string | undefined {
  if (value == null || typeof value !== "string") return undefined;
  const normalized = value.replace(/\s*\*\s?/g, " ").trim();
  const match = normalized.match(DATASOURCE_COMMENT_REGEX);
  return match ? match[1] : undefined;
}