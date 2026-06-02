import type { LintMessage } from '../types';

export const RULE_ID = 'data-render-key';

/**
 * 代表单个 JSX 元素的使用记录
 */
export interface JsxUsageRecord {
  /** 组件名或 HTML 标签名（如 'MyButton', 'div'） */
  tagName: string;
  /**
   * 该 JSX 元素上使用的 CSS className 全局唯一标识列表。
   *
   * - 来自 CSS Module（如 `css.btn`）：格式为 `"<lessFilePath>::<className>"`，
   *   例如 `"./index.module.less::btn"`。路径未能解析时降级为 `"<varName>::<className>"`。
   * - 来自字符串字面量（如 `className="foo bar"`）：格式为 `"::foo"`（无来源前缀）。
   *
   * 使用带来源的 key 是为了防止不同 less 文件中同名 class 被误判为"多处使用"。
   */
  cssClassNames: string[];
  /** 是否已有 data-render-key 属性 */
  hasRenderKey: boolean;
  /** data-render-key 的值（若存在） */
  renderKeyValue?: string;
  /** 源码位置 */
  loc: { start: { line: number; column: number }; end: { line: number; column: number } };
  /** 所属文件名 */
  fileName: string;
}

/**
 * 判断是否为自定义组件（首字母大写）
 */
function isCustomComponent(tagName: string): boolean {
  return /^[A-Z]/.test(tagName);
}

/**
 * 从 JSX 元素节点中提取所有 CSS className 的全局唯一标识。
 *
 * - CSS Module 成员访问（如 `css.btn`）：返回 `"<lessFilePath>::btn"`。
 *   若变量名在 cssModuleImports 中找不到，则降级为 `"<varName>::btn"`。
 * - 字符串字面量 className（如 `className="foo bar"`）：返回 `"::foo"`、`"::bar"`（无来源前缀）。
 *
 * @param node            JSX 元素 AST 节点
 * @param cssModuleImports CSS module 变量名 → less 文件路径的映射（由 ImportDeclaration 收集）
 */
function extractCssClassNamesFromJSX(
  node: any,
  cssModuleImports: Map<string, string>,
): string[] {
  const classNameAttr = node?.openingElement?.attributes?.find(
    (attr: any) => attr?.name?.name === 'className',
  );
  if (!classNameAttr) return [];

  // 字符串字面量：className="foo bar" → ["::foo", "::bar"]
  if (classNameAttr.value?.type === 'StringLiteral') {
    return classNameAttr.value.value
      .split(/\s+/)
      .map((name: string) => name.trim())
      .filter(Boolean)
      .map((name: string) => `::${name}`);
  }

  const expression =
    classNameAttr.value?.type === 'JSXExpressionContainer'
      ? classNameAttr.value.expression
      : null;
  if (!expression) return [];

  // 递归提取所有 MemberExpression（css.xxx / styles.xxx 等）
  const result: string[] = [];
  collectCssModuleClassNames(expression, cssModuleImports, result);
  return result;
}

/**
 * 递归遍历 className 表达式，提取 CSS Module 成员访问，
 * 生成 `"<lessFilePath>::<className>"` 格式的 key。
 */
function collectCssModuleClassNames(
  node: any,
  cssModuleImports: Map<string, string>,
  result: string[],
): void {
  if (!node) return;

  if (node.type === 'MemberExpression') {
    const obj = node.object;
    const prop = node.property;
    if (obj?.type === 'Identifier') {
      const varName: string = obj.name;
      // 只处理已知的 CSS module 变量，跳过其他对象（如 React.xxx）
      if (cssModuleImports.has(varName)) {
        const lessPath = cssModuleImports.get(varName)!;
        const prefix = `${lessPath}`;
        // styles.classname
        if (prop?.type === 'Identifier') {
          result.push(`${prefix}::${prop.name}`);
        }
        // styles['classname']
        if (node.computed && prop?.type === 'StringLiteral') {
          result.push(`${prefix}::${prop.value}`);
        }
      }
    }
    return;
  }

  if (node.type === 'BinaryExpression' && node.operator === '+') {
    collectCssModuleClassNames(node.left, cssModuleImports, result);
    collectCssModuleClassNames(node.right, cssModuleImports, result);
    return;
  }

  if (node.type === 'TemplateLiteral') {
    for (const expr of node.expressions || []) {
      collectCssModuleClassNames(expr, cssModuleImports, result);
    }
    return;
  }

  if (node.type === 'ConditionalExpression') {
    collectCssModuleClassNames(node.consequent, cssModuleImports, result);
    collectCssModuleClassNames(node.alternate, cssModuleImports, result);
    return;
  }

  if (node.type === 'LogicalExpression') {
    collectCssModuleClassNames(node.left, cssModuleImports, result);
    collectCssModuleClassNames(node.right, cssModuleImports, result);
    return;
  }
}

/**
 * 从 JSX 开放标签属性中提取 data-render-key 的值（undefined 表示不存在）
 */
function getDataRenderKey(node: any): string | undefined {
  const attr = node?.openingElement?.attributes?.find(
    (a: any) => a?.name?.name === 'data-render-key',
  );
  if (!attr) return undefined;
  if (attr.value?.type === 'StringLiteral') return attr.value.value;
  if (attr.value?.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression;
    if (expr?.type === 'StringLiteral') return expr.value;
    return '(dynamic)';
  }
  return '';
}

/**
 * 创建单文件扫描插件，收集该文件中所有 JSX 使用记录。
 *
 * 工作原理：
 * 1. 在 ImportDeclaration 阶段收集所有 CSS module import，建立 变量名 → less路径 映射表。
 *    例如 `import css from './index.module.less'` → Map{ css: './index.module.less' }
 * 2. 在 JSXElement 阶段利用上述映射，将 className 提取为带来源的唯一 key：
 *    `css.modalContent` + 映射 → `"./index.module.less::modalContent"`
 *    这样来自不同 less 文件的同名 class 不会被错误地判断为"同一个 class 多处使用"。
 *
 * @param fileName 文件名
 * @returns { plugin, getRecords }
 */
export function createDataRenderKeyCollector(fileName: string): {
  plugin: (babel: any) => { visitor: Record<string, any> };
  getRecords: () => JsxUsageRecord[];
} {
  const records: JsxUsageRecord[] = [];

  function plugin(_babel: any) {
    // CSS module 变量名 → less 文件路径的映射（在 ImportDeclaration 阶段填充）
    const cssModuleImports = new Map<string, string>();

    return {
      visitor: {
        // ── 收集 CSS module import ──
        // 识别 `import xxx from '*.less'` 或 `import xxx from '*.css'` 形式的默认导入
        ImportDeclaration(path: any) {
          const source: string = path.node.source?.value ?? '';
          if (!/\.(less|css|scss|sass)$/.test(source)) return;

          for (const specifier of path.node.specifiers ?? []) {
            if (specifier.type === 'ImportDefaultSpecifier') {
              // import css from './index.module.less'
              cssModuleImports.set(specifier.local.name, source);
            } else if (specifier.type === 'ImportNamespaceSpecifier') {
              // import * as css from './index.module.less'
              cssModuleImports.set(specifier.local.name, source);
            }
          }
        },

        JSXElement(path: any) {
          const node = path.node;
          const openingEl = node?.openingElement;
          if (!openingEl) return;

          // 获取标签名
          const nameNode = openingEl.name;
          let tagName: string | undefined;
          if (nameNode?.type === 'JSXIdentifier') {
            tagName = nameNode.name;
          } else if (nameNode?.type === 'JSXMemberExpression') {
            // 如 <A.B> → 'A.B'
            const buildMember = (n: any): string => {
              if (n?.type === 'JSXMemberExpression') {
                return `${buildMember(n.object)}.${n.property?.name ?? ''}`;
              }
              return n?.name ?? '';
            };
            tagName = buildMember(nameNode);
          }
          if (!tagName) return;

          const cssClassNames = extractCssClassNamesFromJSX(node, cssModuleImports);
          const renderKeyValue = getDataRenderKey(node);
          const hasRenderKey = renderKeyValue !== undefined;
          const loc = openingEl.loc ?? { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };

          records.push({
            tagName,
            cssClassNames,
            hasRenderKey,
            renderKeyValue,
            loc,
            fileName,
          });
        },
      },
    };
  }

  return { plugin, getRecords: () => [...records] };
}

/**
 * 在所有文件的 JsxUsageRecord 全部采集完成后，
 * 进行跨文件聚合校验，返回 data-render-key 相关的 LintMessage[]。
 *
 * 规则：
 * 1. comRef/popupRef 声明的组件：若同一组件在多处使用（跨文件），每处都必须有 data-render-key（少写 → error）
 *    → 将所有缺少 data-render-key 的位置收敛为一条消息，附带行号列表
 * 2. CSS className（如 css.xxx）：若同一文件内同一 className 在多个 JSX 元素上使用，每处都必须有 data-render-key（少写 → error）
 *    → 将所有缺少 data-render-key 的位置收敛为一条消息，附带行号列表
 *    注意：className 多处使用的统计是文件级别的，不同文件中相同 className 不会互相影响。
 *    三方组件和原生 HTML 标签仅通过 className 是否在同一文件中多处使用来判断
 * 3. 多写：若某 JSX 元素有 data-render-key，但对应的组件/className 只使用一次，则报错（多余 → error）
 *    → 将同一文件内所有"多余"位置收敛为一条消息，附带行号列表
 * 4. 静态值：data-render-key 的值必须是静态字符串字面量，禁止使用变量、模板字符串、表达式或动态拼接（动态值 → error）
 *    → 将同一文件内所有动态值位置收敛为一条消息
 * 5. 重复值：若多个 JSX 元素使用了相同的 data-render-key 值，则报错（重复 → error）
 *    → 每组重复值收敛为一条消息
 *
 * @param allRecords      所有文件的 JsxUsageRecord 聚合
 * @param comRefNames     通过 comRef/popupRef 声明的组件名集合（仅这些组件才按"名称多处使用"规则校验）
 */
export function checkDataRenderKey(
  allRecords: JsxUsageRecord[],
  comRefNames: Set<string> = new Set(),
): LintMessage[] {
  const messages: LintMessage[] = [];

  // ── 1. 统计 comRef/popupRef 声明的自定义组件使用次数 ──
  // 只有通过 comRef 或 popupRef 声明的组件才按"名称多处使用"规则校验；
  // 三方组件（如 antd Button）和原生 HTML 标签仅通过 className 来判断。
  const componentUsages = new Map<string, JsxUsageRecord[]>();
  for (const record of allRecords) {
    if (!isCustomComponent(record.tagName)) continue;
    if (!comRefNames.has(record.tagName)) continue; // 跳过非 comRef/popupRef 组件
    const existing = componentUsages.get(record.tagName) ?? [];
    existing.push(record);
    componentUsages.set(record.tagName, existing);
  }

  // ── 2. 统计 CSS className 使用次数（按文件分组，仅在同一文件内统计多次使用）──
  // key: "<fileName>::<cssClassNameKey>", value: 所有使用记录
  // 注意：不同文件中相同的 className（无论来自同一 less 文件还是不同 less 文件）
  // 属于各自独立的组件，不应被视为"同一个 className 多处使用"。
  const classNameUsages = new Map<string, JsxUsageRecord[]>();
  for (const record of allRecords) {
    for (const cn of record.cssClassNames) {
      // 在 cn key 前面加上文件名，确保只在同一文件内统计
      const fileScoped = `${record.fileName}||${cn}`;
      const existing = classNameUsages.get(fileScoped) ?? [];
      existing.push(record);
      classNameUsages.set(fileScoped, existing);
    }
  }

  // ── 3. 判断"需要 data-render-key"的 JSX 元素集合 ──
  // 如果某个 JSX 元素的组件名或任意 className 被多处使用，则该元素需要 data-render-key
  // 使用 Map<record, Set<reason>> 记录每个 record 需要 data-render-key 的原因
  const needsRenderKey = new Map<JsxUsageRecord, Set<string>>();

  for (const [tagName, usages] of componentUsages) {
    if (usages.length >= 2) {
      for (const record of usages) {
        const reasons = needsRenderKey.get(record) ?? new Set<string>();
        reasons.add(`组件 <${tagName}> 在 ${usages.length} 处使用`);
        needsRenderKey.set(record, reasons);
      }
    }
  }

  for (const [fileScoped, usages] of classNameUsages) {
    if (usages.length >= 2) {
      // fileScoped 格式为 "<fileName>||<lessFilePath>::<className>" 或 "<fileName>||::<className>"
      // 提取 cn 部分（"||" 之后）
      const cn = fileScoped.slice(fileScoped.indexOf('||') + 2);
      // cn 格式为 "<lessFilePath>::<className>" 或 "::<className>"（字符串字面量）
      // 提取可读的显示名：取 "::" 后面的部分
      const displayCn = cn.includes('::') ? cn.slice(cn.indexOf('::') + 2) : cn;
      const sourceHint = cn.includes('::') && cn.indexOf('::') > 0
        ? ` (来自 ${cn.slice(0, cn.indexOf('::'))})`
        : '';
      for (const record of usages) {
        const reasons = needsRenderKey.get(record) ?? new Set<string>();
        reasons.add(`CSS className "${displayCn}"${sourceHint} 在 ${usages.length} 处使用`);
        needsRenderKey.set(record, reasons);
      }
    }
  }

  // ── 4. 将"缺少"的 record 按"同一文件 + 同一 reasons 组合"分组，收敛为一条消息 ──
  // 分组 key = fileName + 所有触发原因的排序拼接，保证 reasons 完全相同的 record 归入同一组。
  const missingGroups = new Map<
    string,
    { reasons: Set<string>; records: JsxUsageRecord[]; fileName: string }
  >();

  for (const record of allRecords) {
    const reasons = needsRenderKey.get(record);
    if (!reasons || reasons.size === 0) continue;
    if (record.hasRenderKey) continue;

    const sortedReasons = Array.from(reasons).sort();
    const groupKey = `${record.fileName}::${sortedReasons.join('|')}`;
    const group = missingGroups.get(groupKey) ?? {
      reasons,
      records: [],
      fileName: record.fileName,
    };
    group.records.push(record);
    missingGroups.set(groupKey, group);
  }

  for (const { reasons, records, fileName } of missingGroups.values()) {
    const reasonList = Array.from(reasons).join('；');
    const sortedRecords = [...records].sort(
      (a, b) => a.loc.start.line - b.loc.start.line || a.loc.start.column - b.loc.start.column,
    );
    const lineList = sortedRecords.map(r => `第 ${r.loc.start.line} 行`).join('、');
    const firstRecord = sortedRecords[0];

    messages.push({
      ruleId: RULE_ID,
      severity: 2,
      message:
        records.length === 1
          ? `[data-render-key] 缺少 data-render-key 属性。原因：${reasonList}。请在此 JSX 元素上添加唯一的 data-render-key 属性，例如 data-render-key="unique-key"。`
          : `[data-render-key] 缺少 data-render-key 属性（共 ${records.length} 处）。原因：${reasonList}。涉及位置：${lineList}。请在每处 JSX 元素上添加唯一的 data-render-key 属性，例如 data-render-key="unique-key"。`,
      line: firstRecord.loc.start.line,
      column: firstRecord.loc.start.column,
      endLine: sortedRecords[sortedRecords.length - 1].loc.end.line,
      endColumn: sortedRecords[sortedRecords.length - 1].loc.end.column,
      nodeType: 'JSXElement',
      fileName,
    });
  }

  // ── 5. 多余的 data-render-key 错误（同一文件内收敛为一条消息）──
  // 若某 JSX 元素有 data-render-key，但该元素的组件名/className 均只使用一次，则属于多写。
  const extraGroups = new Map<string, JsxUsageRecord[]>();

  for (const record of allRecords) {
    const reasons = needsRenderKey.get(record);
    const needsKey = !!reasons && reasons.size > 0;
    if (!needsKey && record.hasRenderKey) {
      const existing = extraGroups.get(record.fileName) ?? [];
      existing.push(record);
      extraGroups.set(record.fileName, existing);
    }
  }

  for (const [fileName, records] of extraGroups) {
    const sortedRecords = [...records].sort(
      (a, b) => a.loc.start.line - b.loc.start.line || a.loc.start.column - b.loc.start.column,
    );
    const lineList = sortedRecords.map(r => `第 ${r.loc.start.line} 行`).join('、');
    const firstRecord = sortedRecords[0];

    messages.push({
      ruleId: RULE_ID,
      severity: 2,
      message:
        records.length === 1
          ? `[data-render-key] 多余的 data-render-key 属性。此处组件或 className 仅在一处使用，无需 data-render-key，请删除该属性。`
          : `[data-render-key] 多余的 data-render-key 属性（共 ${records.length} 处）。涉及位置：${lineList}。这些位置的组件或 className 仅在一处使用，无需 data-render-key，请删除相应属性。`,
      line: firstRecord.loc.start.line,
      column: firstRecord.loc.start.column,
      endLine: sortedRecords[sortedRecords.length - 1].loc.end.line,
      endColumn: sortedRecords[sortedRecords.length - 1].loc.end.column,
      nodeType: 'JSXElement',
      fileName,
    });
  }

  // ── 6. data-render-key 值必须是静态字符串字面量（动态值 → error）──
  // 禁止使用变量、模板字符串、表达式或动态拼接作为 data-render-key 的值。
  // getDataRenderKey 已将所有非静态值标记为 '(dynamic)'，此处统一报错。
  const dynamicKeyGroups = new Map<string, JsxUsageRecord[]>();
  for (const record of allRecords) {
    if (!record.hasRenderKey) continue;
    if (record.renderKeyValue !== '(dynamic)') continue;
    const existing = dynamicKeyGroups.get(record.fileName) ?? [];
    existing.push(record);
    dynamicKeyGroups.set(record.fileName, existing);
  }

  for (const [fileName, records] of dynamicKeyGroups) {
    const sortedRecords = [...records].sort(
      (a, b) => a.loc.start.line - b.loc.start.line || a.loc.start.column - b.loc.start.column,
    );
    const lineList = sortedRecords.map(r => `第 ${r.loc.start.line} 行`).join('、');
    const firstRecord = sortedRecords[0];

    messages.push({
      ruleId: RULE_ID,
      severity: 2,
      message:
        records.length === 1
          ? `[data-render-key] data-render-key 的值必须是静态字符串字面量，禁止使用变量、模板字符串、表达式或动态拼接。正确示例：data-render-key="submit-btn"；错误示例：data-render-key={\`btn-\${index}\`}、data-render-key={key}、data-render-key={"btn-" + id}。`
          : `[data-render-key] data-render-key 的值必须是静态字符串字面量（共 ${records.length} 处）。涉及位置：${lineList}。禁止使用变量、模板字符串、表达式或动态拼接。正确示例：data-render-key="submit-btn"。`,
      line: firstRecord.loc.start.line,
      column: firstRecord.loc.start.column,
      endLine: sortedRecords[sortedRecords.length - 1].loc.end.line,
      endColumn: sortedRecords[sortedRecords.length - 1].loc.end.column,
      nodeType: 'JSXElement',
      fileName,
    });
  }

  // ── 7. 重复的 data-render-key 值错误（同一值被多个元素使用）──
  // 每个 data-render-key 的值在所有文件中必须唯一（动态值跳过校验）。
  const renderKeyValueUsages = new Map<string, JsxUsageRecord[]>();
  for (const record of allRecords) {
    if (!record.hasRenderKey) continue;
    const val = record.renderKeyValue;
    if (!val || val === '(dynamic)') continue; // 动态值无法静态比较，跳过
    const existing = renderKeyValueUsages.get(val) ?? [];
    existing.push(record);
    renderKeyValueUsages.set(val, existing);
  }

  for (const [val, records] of renderKeyValueUsages) {
    if (records.length < 2) continue;
    const sortedRecords = [...records].sort(
      (a, b) =>
        a.fileName.localeCompare(b.fileName) ||
        a.loc.start.line - b.loc.start.line ||
        a.loc.start.column - b.loc.start.column,
    );
    const locationList = sortedRecords
      .map(r => `${r.fileName} 第 ${r.loc.start.line} 行`)
      .join('、');
    const firstRecord = sortedRecords[0];

    messages.push({
      ruleId: RULE_ID,
      severity: 2,
      message: `[data-render-key] data-render-key 值 "${val}" 重复使用了 ${records.length} 次（${locationList}）。每个 data-render-key 值必须全局唯一，请修改为不同的值。`,
      line: firstRecord.loc.start.line,
      column: firstRecord.loc.start.column,
      endLine: sortedRecords[sortedRecords.length - 1].loc.end.line,
      endColumn: sortedRecords[sortedRecords.length - 1].loc.end.column,
      nodeType: 'JSXElement',
      fileName: firstRecord.fileName,
    });
  }

  return messages;
}
