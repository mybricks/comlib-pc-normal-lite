import type { LintMessage } from '../types';
import type { ComRefInfo } from './extract-comrefs';
import type { MybricksJSDoc } from '../../../utils/ai-code/plugins/utils/parseMybricksJSDoc';

export const RULE_ID = 'jsdoc-check';

function createMessage(message: string, nodeType = 'list'): LintMessage {
  return {
    ruleId: RULE_ID,
    severity: 2,
    message: `[JSDoc校验] ${message}`,
    line: 1,
    column: 0,
    nodeType,
  };
}

// ─── events 校验 ──────────────────────────────────────────────────────────────

/**
 * 校验 JSDoc events 与源码中实际使用的 events 是否一致。
 *
 * JSDoc events 格式（来自 MybricksJSDoc）：
 *   events:
 *     loginBtn:
 *       onClick:
 *         title: 点击登录
 *
 * ComRefInfo events 格式（来自源码 AST 分析）：
 *   { loginBtn: ['onClick', 'onChange'], ... }
 *
 * 校验方向：源码中使用了但 JSDoc 未声明的事件 → 报错。
 */
function checkEvents(
  componentName: string,
  jsdoc: MybricksJSDoc,
  comRefInfo: ComRefInfo,
  messages: LintMessage[],
): void {
  const jsdocEvents = jsdoc.events ?? {};

  // 收集 JSDoc 中已声明的所有事件 handler（不区分 className）
  const documentedHandlers = new Set<string>();
  for (const handlers of Object.values(jsdocEvents)) {
    if (handlers && typeof handlers === 'object') {
      for (const handlerName of Object.keys(handlers)) {
        documentedHandlers.add(handlerName);
      }
    }
  }

  // 收集源码中实际使用的所有事件 handler（不区分 className），报告缺失项
  const missingEntries: { className: string; handlers: string[] }[] = [];
  for (const [className, handlers] of Object.entries(comRefInfo.events)) {
    const missing = handlers.filter(h => !documentedHandlers.has(h));
    if (missing.length > 0) {
      missingEntries.push({ className, handlers: missing });
    }
  }

  if (missingEntries.length > 0) {
    const details = missingEntries
      .map(({ className, handlers }) => `.${className} 节点配置了 ${handlers.join(', ')}`)
      .join('；');
    messages.push(
      createMessage(`组件 ${componentName} 源码在 ${details}，未在 JSDoc 的 events 中声明。`),
    );
  }
}

// ─── datasource 校验 ──────────────────────────────────────────────────────────

/**
 * 校验 JSDoc datasource 与源码中实际调用的 datasource api 是否一致。
 *
 * JSDoc datasource 格式（来自 MybricksJSDoc）：
 *   datasource:
 *     loginBtn:
 *       login:
 *         desc: 调用登录接口
 *
 * ComRefInfo datasource 格式（来自源码 AST 分析）：
 *   { loginBtn: ['login', 'logout'], ... }
 *
 * 校验方向：源码中调用了但 JSDoc 未声明的 api → 报错。
 */
function checkDatasource(
  componentName: string,
  jsdoc: MybricksJSDoc,
  comRefInfo: ComRefInfo,
  messages: LintMessage[],
): void {
  const jsdocDatasource = jsdoc.datasource ?? {};

  // 收集 JSDoc 中已声明的所有 api（不区分 className）
  const documentedApis = new Set<string>();
  for (const apis of Object.values(jsdocDatasource)) {
    if (apis && typeof apis === 'object') {
      for (const apiName of Object.keys(apis)) {
        documentedApis.add(apiName);
      }
    }
  }

  // 收集源码中实际调用的所有 api（不区分 className）
  const expectedApis = new Set<string>();
  for (const apis of Object.values(comRefInfo.datasource)) {
    for (const api of apis) {
      expectedApis.add(api);
    }
  }

  const missingApis = Array.from(expectedApis).filter(api => !documentedApis.has(api));
  if (missingApis.length > 0) {
    messages.push(
      createMessage(
        `组件 ${componentName} 调用了 datasource 的 ${missingApis.join(', ')} 方法，需要在 JSDoc 的 datasource 中声明。`,
      ),
    );
  }
}

// ─── store 校验 ───────────────────────────────────────────────────────────────

/**
 * 校验 JSDoc store 与源码中实际消费的 store 字段是否一致。
 *
 * JSDoc store 格式（来自 MybricksJSDoc）：
 *   store:
 *     userNameInput:
 *       /store.js:
 *         userName:
 *           desc: 用户名输入值
 *
 * ComRefInfo store 格式（来自源码 AST 分析）：
 *   { userNameInput: ['store.userName', ...], ... }
 *
 * 校验方向：源码中消费了但 JSDoc 未声明的字段 → 报错。
 */
function checkStore(
  componentName: string,
  jsdoc: MybricksJSDoc,
  comRefInfo: ComRefInfo,
  messages: LintMessage[],
): void {
  const jsdocStore = jsdoc.store ?? {};

  // 收集 JSDoc 中已声明的所有 store 字段（展平所有层级中的叶子 key，不含 /store.js 这层中间 key）
  const documentedFields = new Set<string>();

  function collectLeafKeys(obj: Record<string, any>, depth = 0): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && Object.keys(value).length > 0) {
        if (depth === 0) {
          // 第 0 层：className（如 userNameInput）
          collectLeafKeys(value, depth + 1);
        } else if (depth === 1) {
          // 第 1 层：store 文件路径（如 /store.js），继续展开
          collectLeafKeys(value, depth + 1);
        } else {
          // 第 2 层：字段名（如 userName）
          documentedFields.add(key);
          collectLeafKeys(value, depth + 1);
        }
      } else if (depth >= 2) {
        documentedFields.add(key);
      }
    }
  }

  collectLeafKeys(jsdocStore);

  // 收集源码中实际消费的所有 store 字段（不区分 className）
  const expectedFields = new Set<string>();
  for (const fields of Object.values(comRefInfo.store)) {
    for (const field of fields) {
      // field 可能是 "store.userName"，取最后一段
      const parts = field.split('.');
      const leaf = parts[parts.length - 1];
      if (leaf) expectedFields.add(leaf);
      expectedFields.add(field);
    }
  }

  const missingFields = Array.from(expectedFields).filter(
    f => !documentedFields.has(f),
  );

  if (missingFields.length > 0) {
    messages.push(
      createMessage(
        `组件 ${componentName} 源码中对 store 的 ${missingFields.join(', ')} 字段进行了消费，未在 JSDoc 的 store 中声明。`,
      ),
    );
  }
}

// ─── 必填字段校验 ─────────────────────────────────────────────────────────────

/**
 * 校验 JSDoc 必填字段：title、summary、type。
 */
function checkRequiredFields(
  componentName: string,
  jsdoc: MybricksJSDoc,
  messages: LintMessage[],
): void {
  if (!jsdoc.title) {
    messages.push(createMessage(`组件 ${componentName} 的 JSDoc 缺少 title 字段。`));
  }
  if (!jsdoc.summary) {
    messages.push(createMessage(`组件 ${componentName} 的 JSDoc 缺少 summary 字段。`));
  }
  if (!jsdoc.type) {
    messages.push(createMessage(`组件 ${componentName} 的 JSDoc 缺少 type 字段。`));
  }
}

// ─── 主校验函数 ───────────────────────────────────────────────────────────────

/**
 * JSDoc 规范校验规则。
 *
 * 不依赖 README.md，直接通过组件侧注释（@mybricks JSDoc）与 AST 分析结果对比，
 * 校验 events / datasource / store 声明是否完整。
 *
 * 涵盖两个层面：
 * 1. 格式校验：JSDoc 必填字段（title / summary / type）
 * 2. 跨文件节点一致性校验：JSDoc 中的 events/datasource/store 与源码实际使用对比
 *
 * @param jsdocMap    由 collectJsDocPlugin 采集的 JSDoc Map，key 为组件变量名
 * @param comRefInfos 从 JSX 文件提取的节点信息列表（来自 extract-comrefs）
 * @param fileName    文件名（用于 LintMessage.fileName）
 * @returns           LintMessage 数组
 */
export function checkJSDoc(
  jsdocMap: Map<string, MybricksJSDoc>,
  comRefInfos: ComRefInfo[],
  fileName: string,
): LintMessage[] {
  const messages: LintMessage[] = [];

  // 如果没有任何 JSDoc，直接跳过（不强制要求所有组件都写 JSDoc）
  if (!jsdocMap.size) return messages;

  // 建立 comRefInfo 的快速查找表：name → ComRefInfo
  const comRefMap = new Map<string, ComRefInfo>();
  for (const info of comRefInfos) {
    comRefMap.set(info.name, info);
  }

  // 遍历 JSDoc Map，对每个有 JSDoc 的组件进行校验
  for (const [componentName, jsdoc] of jsdocMap.entries()) {
    // 必填字段校验
    checkRequiredFields(componentName, jsdoc, messages);

    // 只有当源码中存在对应组件时，才做 events/datasource/store 的一致性校验
    const comRefInfo = comRefMap.get(componentName);
    if (!comRefInfo) continue;

    checkEvents(componentName, jsdoc, comRefInfo, messages);
    checkDatasource(componentName, jsdoc, comRefInfo, messages);
    checkStore(componentName, jsdoc, comRefInfo, messages);
  }

  // 反向校验：源码中有组件，但没有对应 JSDoc
  for (const info of comRefInfos) {
    if (info.name === 'default') continue; // appRef root 不强制要求独立 JSDoc
    if (!jsdocMap.has(info.name)) {
      messages.push(
        createMessage(
          `组件 ${info.name} 在源码中存在，但缺少 @mybricks JSDoc 注释。`,
          'heading',
        ),
      );
    }
  }

  console.log("[checkJSDoc:messages]", messages)
  console.log('[checkJSDoc:filename]', fileName)

  return messages.map(msg => ({ ...msg, fileName }));
}
