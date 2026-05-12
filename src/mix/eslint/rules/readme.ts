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

function hasRecordItems(record?: Record<string, unknown>): boolean {
  return !!record && Object.values(record).some(items => Array.isArray(items) && items.length > 0);
}

function getExpectedInfo(comRefInfos: ComRefInfo[], name: string): ComRefInfo | undefined {
  return comRefInfos.find(info => info.name === name);
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

function checkEvents(blockName: string, block: SummaryBlock, expected: ComRefInfo | undefined, messages: LintMessage[]) {
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
    messages.push(createMessage(`组件 ${blockName} 源码在 ${details}，未在 README events 中声明。`));
  }
}

function checkDatasource(blockName: string, block: SummaryBlock, expected: ComRefInfo | undefined, messages: LintMessage[]) {
  const datasource = block.datasource;
  const seen = new Set<string>();

  for (const [className, apis] of Object.entries(datasource ?? {})) {
    if (!className) {
      messages.push(createMessage(`组件 ${blockName} 的 datasource 存在空 className/root 标识。`));
      continue;
    }

    const apiEntries = Object.entries(apis ?? {});

    for (const [api, meta] of apiEntries) {
      if (!api) {
        messages.push(createMessage(`组件 ${blockName} 的 datasource.${className} 存在空接口名。`));
        continue;
      }

      checkDuplicate(
        seen,
        api,
        `组件 ${blockName} 的 datasource.${api} 重复声明。`,
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
    messages.push(createMessage(`组件 ${blockName} 调用了 datasource 的 ${missingApis.join(',')} 方法，需要在 README datasource 中声明。`));
  }
}

function checkStore(blockName: string, block: SummaryBlock, expected: ComRefInfo | undefined, messages: LintMessage[]) {
  const store = block.store;

  for (const [className, items] of Object.entries(store ?? {})) {
    if (!className) {
      messages.push(createMessage(`组件 ${blockName} 的 store 存在空 className/root 标识。`));
      continue;
    }

    if (!Array.isArray(items) || items.length === 0) {
      messages.push(createMessage(`组件 ${blockName} 的 store.${className} 缺少字段项。`));
      continue;
    }
  }

  if (!expected) return;

  // 收集 README 中所有已声明的 store 字段（不区分 selector）
  const documentedFields = new Set<string>();
  for (const items of Object.values(store ?? {})) {
    for (const item of items ?? []) {
      if (item.field) documentedFields.add(item.field);
    }
  }

  // 收集代码中实际消费的所有 store 字段（不区分 selector）
  const expectedFields = new Set<string>();
  for (const fields of Object.values(expected.store)) {
    for (const field of fields) {
      expectedFields.add(field);
    }
  }

  const missingFields = Array.from(expectedFields).filter(field => !documentedFields.has(field));
  if (missingFields.length > 0) {
    messages.push(createMessage(`组件 ${blockName} 源码中对 store 的 ${missingFields.join(',')} 字段进行了消费，未在 README store 中声明。`));
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

  // ─── 2. 每个节点必须有 title、summary、type 字段 ───
  for (const [name, block] of Object.entries(parsed)) {
    if (!block.title) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${name}" 缺少 title 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }
    if (!block.summary) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${name}" 缺少 summary 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }
    if (!block.type) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${name}" 缺少 type 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }

    const expected = getExpectedInfo(comRefInfos, name);
    checkEvents(name, block, expected, messages);
    checkDatasource(name, block, expected, messages);
    checkStore(name, block, expected, messages);
  }

  // ─── 3. 跨文件节点一致性校验 ───
  const jsxNodeNames = new Set<string>(comRefInfos.map(info => info.name));
  const readmeNodeNames = new Set<string>(
    Object.keys(parsed).filter(name => name !== 'default')
  );

  // 3.1 README 中有但 JSX 中没有的节点
  for (const name of readmeNodeNames) {
    if (!jsxNodeNames.has(name)) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${name}" 在源码中不存在。`,
        line: 1,
        column: 0,
        nodeType: 'heading',
      });
    }
  }

  // 3.2 JSX 中有但 README 中没有的节点
  for (const info of comRefInfos) {
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
    if (!readmeNodeNames.has(info.name)) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 源码中的 "${info.name}" 在文档中未声明。`,
        line: 1,
        column: 0,
        nodeType: 'heading',
      });
    }
  }

  return messages.map(msg => ({ ...msg, fileName }));
}
