import type { LintMessage } from '../types';
import type { ComRefInfo } from './extract-comrefs';
import type { ParsedSummary, SummaryBlock } from '../../../utils/ai-code/md';

export const RULE_ID = 'readme-check';

function createMessage(message: string, nodeType = 'list'): LintMessage {
  return {
    ruleId: RULE_ID,
    severity: 2,
    message: `[文档校验] ${message}`,
    line: 1,
    column: 0,
    nodeType,
  };
}

type ReadmeBlockEntry = {
  name: string;
  block: SummaryBlock;
  path: string;
};

function collectReadmeBlockEntries(
  blocks: Record<string, SummaryBlock> | undefined,
  parentPath: string[] = [],
): ReadmeBlockEntry[] {
  if (!blocks) return [];

  const entries: ReadmeBlockEntry[] = [];
  for (const [name, block] of Object.entries(blocks)) {
    const pathParts = [...parentPath, name];
    entries.push({ name, block, path: pathParts.join(' > ') });
    entries.push(...collectReadmeBlockEntries(block.children, pathParts));
  }

  return entries;
}

function createExpectedQueues(comRefInfos: ComRefInfo[]): Map<string, ComRefInfo[]> {
  const queues = new Map<string, ComRefInfo[]>();
  for (const info of comRefInfos) {
    const queue = queues.get(info.name) ?? [];
    queue.push(info);
    queues.set(info.name, queue);
  }
  return queues;
}

function consumeExpected(
  queues: Map<string, ComRefInfo[]>,
  name: string,
): ComRefInfo | undefined {
  return queues.get(name)?.shift();
}

function getSourceLabel(expected: ComRefInfo | undefined, fallbackName: string): string {
  return `组件 ${expected?.name ?? fallbackName}`;
}

function checkDuplicate(
  seen: Set<string>,
  key: string,
  label: string,
  messages: LintMessage[],
) {
  if (seen.has(key)) {
    messages.push(createMessage(label));
    return;
  }
  seen.add(key);
}

function checkEvents(
  entry: ReadmeBlockEntry,
  expected: ComRefInfo | undefined,
  messages: LintMessage[],
) {
  const { block } = entry;
  const events = block.events ?? [];
  if (!expected) return;

  // 收集 README 中所有已声明的事件 handler（不区分 selector）
  const documentedHandlers = new Set<string>();
  for (const event of events) {
    for (const handler of event.handlers ?? []) {
      if (handler.handler) documentedHandlers.add(handler.handler);
    }
  }

  // 收集代码中实际使用的所有事件 handler，保留 className 信息用于报错
  const expectedByClassName = Object.entries(expected.events);
  const missingEntries: { className: string; handlers: string[] }[] = [];
  for (const [className, handlers] of expectedByClassName) {
    const missing = handlers.filter(handler => !documentedHandlers.has(handler));
    if (missing.length > 0) {
      missingEntries.push({ className, handlers: missing });
    }
  }
  if (missingEntries.length > 0) {
    const details = missingEntries.map(({ className, handlers }) => `.${className} 节点配置了 ${handlers.join(',')}`).join('；');
    messages.push(createMessage(`${getSourceLabel(expected, entry.name)} 源码在 ${details}，未在 README 的 ${entry.path} -> events 中声明。`));
  }
}

function checkDatasource(
  entry: ReadmeBlockEntry,
  expected: ComRefInfo | undefined,
  messages: LintMessage[],
) {
  const { block } = entry;
  const datasource = block.datasource;
  const seen = new Set<string>();

  for (const [className, apis] of Object.entries(datasource ?? {})) {
    if (!className) {
      messages.push(createMessage(`README 的 ${entry.path} -> datasource 存在空 className/root 标识。`));
      continue;
    }

    const apiEntries = Object.entries(apis ?? {});

    for (const [api, meta] of apiEntries) {
      if (!api) {
        messages.push(createMessage(`README 的 ${entry.path} -> datasource.${className} 存在空接口名。`));
        continue;
      }

      checkDuplicate(
        seen,
        api,
        `README 的 ${entry.path} -> datasource.${api} 重复声明。`,
        messages,
      );
    }
  }

  if (!expected) return;

  // 收集 README 中所有已声明的 datasource api（不区分 selector）
  const documentedApis = new Set<string>();
  for (const apis of Object.values(datasource ?? {})) {
    for (const api of Object.keys(apis ?? {})) {
      if (api) documentedApis.add(api);
    }
  }

  // 收集代码中实际调用的所有 datasource api（不区分 selector）
  const expectedApis = new Set<string>();
  for (const apis of Object.values(expected.datasource)) {
    for (const api of apis) {
      expectedApis.add(api);
    }
  }

  const missingApis = Array.from(expectedApis).filter(api => !documentedApis.has(api));
  if (missingApis.length > 0) {
    messages.push(createMessage(`${getSourceLabel(expected, entry.name)} 调用了 datasource 的 ${missingApis.join(',')} 方法，需要在 README 的 ${entry.path} -> datasource 中声明。`));
  }
}

/**
 * README.md 文档规范校验规则。
 *
 * 涵盖两个层面：
 * 1. 格式校验：根节点存在性、节点必填字段（title/summary/type）
 * 2. 跨文件节点一致性校验：README 中的节点集合与 JSX 中的 comRef/popupRef/appRef 必须完全一致
 *
 * 解析工作由 context.ts 在文件写入时完成（parsemd），checkReadme 直接接收 ParsedSummary。
 * 文件存在性校验由 verify() 层面统一处理。
 *
 * @param parsed      已解析的 README 结构（由 context.ts parsemd 产生）
 * @param fileName    文件名（用于 LintMessage.fileName）
 * @param comRefInfos 从 JSX 文件提取的节点信息列表（用于跨文件一致性校验）
 * @returns           LintMessage 数组
 */
export function checkReadme(
  parsed: ParsedSummary,
  fileName: string,
  comRefInfos: ComRefInfo[],
): LintMessage[] {
  const messages: LintMessage[] = [];

  // ─── 1. 根节点存在性：必须有 "default" 键 ───
  if (!parsed['default']) {
    messages.push({
      ruleId: RULE_ID,
      severity: 2,
      message: `[文档校验] README.md 根节点必须为 "# default"。`,
      line: 1,
      column: 0,
      nodeType: 'heading',
    });
  }

  const readmeEntries = collectReadmeBlockEntries(parsed);
  const expectedQueues = createExpectedQueues(comRefInfos);
  const matchedEntries: ReadmeBlockEntry[] = [];

  // ─── 2. 每个节点必须有 title、summary、type 字段 ───
  for (const entry of readmeEntries) {
    const { name, block, path } = entry;
    if (!block.title) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${path}" 缺少 title 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }
    if (!block.summary) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${path}" 缺少 summary 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }
    if (!block.type) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${path}" 缺少 type 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }

    const expected = consumeExpected(expectedQueues, name);
    if (expected) matchedEntries.push(entry);
    checkEvents(entry, expected, messages);
    checkDatasource(entry, expected, messages);
  }

  // ─── 3. 跨文件节点一致性校验 ───
  const matchedEntrySet = new Set(matchedEntries);

  // 3.1 README 中有但 JSX 中没有的节点
  for (const entry of readmeEntries) {
    if (entry.name !== 'default' && !matchedEntrySet.has(entry)) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] README 的 "${entry.path}" 在源码中不存在。`,
        line: 1,
        column: 0,
        nodeType: 'heading',
      });
    }
  }

  // 3.2 JSX 中有但 README 中没有的节点
  for (const info of Array.from(expectedQueues.values()).flat()) {
    if (info.name === 'default') {
      // appRef 对应 README 的 "default" 根节点
      if (!parsed['default']) {
        messages.push({
          ruleId: RULE_ID,
          severity: 2,
          message: `[文档校验] JSX 中存在 appRef 根节点，但 README.md 缺少 "# default" 根节点。`,
          line: 1,
          column: 0,
          nodeType: 'heading',
        });
      }
      continue;
    }
    messages.push({
      ruleId: RULE_ID,
      severity: 2,
      message: `[文档校验] ${getSourceLabel(info, info.name)} 在文档中未声明。`,
      line: 1,
      column: 0,
      nodeType: 'heading',
    });
  }

  return messages.map(msg => ({ ...msg, fileName }));
}
