import type { LintMessage } from '../types';
import type { ComRefInfo } from './extract-comrefs';
import type { MybricksJSDoc } from '../../../utils/ai-code/plugins/utils/parseMybricksJSDoc';

export const RULE_ID = 'jsdoc-check';

const ENABLE_LOG = false

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

  // ── [DEBUG] 打印原始输入 ──────────────────────────────────────────────────
  ENABLE_LOG && console.log(`\n[checkEvents] ▶ 开始校验组件: ${componentName}`);
  ENABLE_LOG && console.log(`[checkEvents][JSDoc来源] jsdoc.events 原始结构:`, JSON.stringify(jsdocEvents, null, 2));
  ENABLE_LOG && console.log(`[checkEvents][AST来源]  comRefInfo.events 原始结构:`, JSON.stringify(comRefInfo.events, null, 2));

  // 收集 JSDoc 中已声明的所有事件 handler（不区分 className）
  const documentedHandlers = new Set<string>();
  for (const handlers of Object.values(jsdocEvents)) {
    if (handlers && typeof handlers === 'object') {
      for (const handlerName of Object.keys(handlers)) {
        documentedHandlers.add(handlerName);
      }
    }
  }

  // ── [DEBUG] 打印展平后的 JSDoc handler 集合 ───────────────────────────────
  ENABLE_LOG && console.log(`[checkEvents][JSDoc来源] 展平后已声明的 handlers（不区分 className）:`, Array.from(documentedHandlers));

  // 收集源码中实际使用的所有事件 handler（不区分 className），报告缺失项
  const missingEntries: { className: string; handlers: string[] }[] = [];
  for (const [className, handlers] of Object.entries(comRefInfo.events)) {
    // ── [DEBUG] 逐 className 对比 ─────────────────────────────────────────
    ENABLE_LOG && console.log(`[checkEvents][对比] className="${className}" → AST中的handlers: [${handlers.join(', ')}]`);
    const missing = handlers.filter(h => {
      const inJSDoc = documentedHandlers.has(h);
      ENABLE_LOG && console.log(`[checkEvents][对比]   handler="${h}" → JSDoc中${inJSDoc ? '已声明 ✓' : '缺失 ✗'}`);
      return !inJSDoc;
    });
    if (missing.length > 0) {
      ENABLE_LOG && console.log(`[checkEvents][结果] className="${className}" 缺失handlers: [${missing.join(', ')}]`);
      missingEntries.push({ className, handlers: missing });
    }
  }

  if (missingEntries.length === 0) {
    ENABLE_LOG && console.log(`[checkEvents][结果] 组件 ${componentName} events 校验通过，无缺失项 ✓`);
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

// ─── state 校验 ───────────────────────────────────────────────────────────────

/**
 * 校验 JSDoc state 与源码中实际使用的 React state 变量是否一致。
 *
 * JSDoc state 格式（来自 MybricksJSDoc）：
 *   state:
 *     usernameInput:
 *       username:
 *         desc: 用户名输入值
 *
 * ComRefInfo state 格式（来自源码 AST 分析，extract-comrefs）：
 *   { usernameInput: ['username', 'password'], ... }
 *
 * state 变量来源：源码中通过 useState / useReducer 声明的解构变量。
 * 关联方式：state 变量在 JSX 表达式容器中被引用时，关联到最近的父级 className。
 *
 * 校验方向：源码中使用了但 JSDoc 未声明的 state 变量 → 报错。
 */
function checkState(
  componentName: string,
  jsdoc: MybricksJSDoc,
  comRefInfo: ComRefInfo,
  messages: LintMessage[],
): void {
  const jsdocState = jsdoc.state ?? {};

  // 收集 JSDoc 中已声明的所有 state 变量名（不区分 className）
  const documentedStateVars = new Set<string>();
  for (const stateVars of Object.values(jsdocState)) {
    if (stateVars && typeof stateVars === 'object') {
      for (const varName of Object.keys(stateVars)) {
        documentedStateVars.add(varName);
      }
    }
  }

  // 收集源码中实际使用的所有 state 变量（不区分 className），报告缺失项
  const missingEntries: { className: string; vars: string[] }[] = [];
  for (const [className, vars] of Object.entries(comRefInfo.state)) {
    const missing = vars.filter(v => !documentedStateVars.has(v));
    if (missing.length > 0) {
      missingEntries.push({ className, vars: missing });
    }
  }

  if (missingEntries.length > 0) {
    const details = missingEntries
      .map(({ className, vars }) => `.${className} 节点使用了 ${vars.join(', ')}`)
      .join('；');
    messages.push(
      createMessage(`组件 ${componentName} 源码在 ${details}（来自 useState/useReducer），未在 JSDoc 的 state 中声明。`),
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
 * 校验 events / datasource / state 声明是否完整。
 *
 * 涵盖两个层面：
 * 1. 格式校验：JSDoc 必填字段（title / summary / type）
 * 2. 跨文件节点一致性校验：JSDoc 中的 events/datasource/state 与源码实际使用对比
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

  // 建立 comRefInfo 的快速查找表：name → ComRefInfo
  const comRefMap = new Map<string, ComRefInfo>();
  for (const info of comRefInfos) {
    comRefMap.set(info.name, info);
  }

  // 遍历 JSDoc Map，对每个有 JSDoc 的组件进行校验
  for (const [componentName, jsdoc] of jsdocMap.entries()) {
    // 必填字段校验
    checkRequiredFields(componentName, jsdoc, messages);

    // 只有当源码中存在对应组件时，才做 events/datasource/state 的一致性校验
    const comRefInfo = comRefMap.get(componentName);
    if (!comRefInfo) continue;

    checkEvents(componentName, jsdoc, comRefInfo, messages);
    checkDatasource(componentName, jsdoc, comRefInfo, messages);
    checkState(componentName, jsdoc, comRefInfo, messages);
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

  ENABLE_LOG && console.log("[checkJSDoc:messages]", messages)
  ENABLE_LOG && console.log('[checkJSDoc:filename]', fileName)

  return messages.map(msg => ({ ...msg, fileName }));
}
