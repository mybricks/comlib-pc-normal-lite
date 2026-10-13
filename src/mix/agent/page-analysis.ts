import YAML from 'yaml';
import { isPageAnalysisEventBlacklisted } from './page-analysis-events';
const parseYaml: (source: string) => unknown = (YAML as any).parse;

/** A decoded source file from the component sandbox. */
export interface AuditSourceFile {
  path: string;
  content: string;
}

type SourceProvider = () => AuditSourceFile[] | Promise<AuditSourceFile[]>;

export interface PageAnalysisOptions {
  /** The project configuration directory containing graph YAML files. */
  configDirName: string;
}

type Location = { line: number; column: number };
type AuditItem = {
  name: string;
  file: string;
  location?: Location;
  target?: string;
  detail?: string;
};

type FileReport = {
  path: string;
  imports: string[];
  components: string[];
  events: AuditItem[];
  requests: AuditItem[];
  renderedState: AuditItem[];
  componentReferences: AuditItem[];
  diagnostics: string[];
};

function isSourceFile(file: AuditSourceFile): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(file.path) && !/\.d\.ts$/i.test(file.path);
}

function location(node: any): Location | undefined {
  const start = node?.loc?.start;
  return start ? { line: start.line, column: start.column + 1 } : undefined;
}

function elementName(node: any): string {
  if (!node) return 'root';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') {
    return `${elementName(node.object)}.${elementName(node.property)}`;
  }
  if (node.type === 'JSXNamespacedName') return `${node.namespace?.name}:${node.name?.name}`;
  return 'root';
}

function expressionText(source: string, node: any): string | undefined {
  if (typeof node?.start !== 'number' || typeof node?.end !== 'number') return undefined;
  return source.slice(node.start, node.end).replace(/\s+/g, ' ').trim() || undefined;
}

function getMemberName(node: any): { root?: string; name?: string } {
  if (!node) return {};
  if (node.type === 'Identifier') return { root: node.name, name: node.name };
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return {};

  const parent = getMemberName(node.object);
  const property = node.computed
    ? node.property?.type === 'StringLiteral' ? node.property.value : undefined
    : node.property?.name;
  return { root: parent.root, name: property ?? parent.name };
}

function findNearestJsxElement(path: any): any {
  let current = path;
  while (current) {
    if (current.isJSXElement?.()) return current.node;
    current = current.parentPath;
  }
  return undefined;
}

function isComponentDeclaration(path: any): boolean {
  const node = path.node;
  if (!node?.id?.name || !/^[A-Z]/.test(node.id.name)) return false;
  let containsJsx = false;
  path.traverse({ JSXElement() { containsJsx = true; } });
  return containsJsx;
}

function isComponentVariable(path: any): boolean {
  const node = path.node;
  if (!node?.id?.name || !/^[A-Z]/.test(node.id.name)) return false;
  if (node.init?.type !== 'ArrowFunctionExpression' && node.init?.type !== 'FunctionExpression') return false;
  let containsJsx = false;
  path.get('init').traverse({ JSXElement() { containsJsx = true; } });
  return containsJsx;
}

function uniqueItems(items: AuditItem[]): AuditItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.name, item.file, item.location?.line, item.location?.column, item.target, item.detail].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createAuditCollector(file: AuditSourceFile) {
  const report: FileReport = {
    path: file.path,
    imports: [],
    components: [],
    events: [],
    requests: [],
    renderedState: [],
    componentReferences: [],
    diagnostics: [],
  };
  const stateNames = new Set<string>();

  const plugin = () => ({
    visitor: {
      ImportDeclaration(path: any) {
      if (typeof path.node.source.value === 'string') report.imports.push(path.node.source.value);
      },
      FunctionDeclaration(path: any) {
      if (isComponentDeclaration(path)) report.components.push(path.node.id.name);
      },
      VariableDeclarator(path: any) {
      if (isComponentVariable(path)) report.components.push(path.node.id.name);
      const init = path.node.init;
      const callee = init?.type === 'CallExpression' || init?.type === 'OptionalCallExpression'
        ? getMemberName(init.callee)
        : {};
      if (!['useState', 'useReducer'].includes(callee.name ?? '')) return;
      const first = path.node.id?.type === 'ArrayPattern' ? path.node.id.elements?.[0] : path.node.id;
      if (first?.type === 'Identifier') stateNames.add(first.name);
      },
      JSXAttribute(path: any) {
      const eventName = path.node.name?.name;
      if (typeof eventName !== 'string' || !/^on[A-Z]/.test(eventName)) return;
      if (isPageAnalysisEventBlacklisted(eventName)) return;
      const element = findNearestJsxElement(path);
      report.events.push({
        name: eventName,
        file: file.path,
        location: location(path.node),
        target: elementName(element?.openingElement?.name),
        detail: expressionText(file.content, path.node.value?.expression ?? path.node.value),
      });
      },
      JSXOpeningElement(path: any) {
      const name = elementName(path.node.name);
      if (!/^[A-Z]/.test(name)) return;
      report.componentReferences.push({ name, file: file.path, location: location(path.node) });
      },
      CallExpression(path: any) {
      const callee = getMemberName(path.node.callee);
      const root = callee.root ?? '';
      const name = callee.name ?? '';
      // This intentionally prefers precision: only record calls made through an
      // obvious request client rather than treating every local helper as an API.
      if (!/^(api|apis|client|http|request|service|dataSource|datasource)$/i.test(root)) return;
      report.requests.push({
        name,
        file: file.path,
        location: location(path.node),
        target: elementName(findNearestJsxElement(path)?.openingElement?.name),
        detail: expressionText(file.content, path.node.callee),
      });
      },
      JSXExpressionContainer(path: any) {
      const expression = path.node.expression;
      if (!expression || expression.type === 'JSXEmptyExpression') return;
      const element = findNearestJsxElement(path);
      path.traverse({
        Identifier(identifierPath: any) {
          const name = identifierPath.node.name;
          if (!stateNames.has(name) || !identifierPath.isReferencedIdentifier()) return;
          report.renderedState.push({
            name,
            file: file.path,
            location: location(identifierPath.node),
            target: elementName(element?.openingElement?.name),
          });
        },
      });
      },
    },
  });

  return { plugin, getReport: () => report };
}

function analyzeFile(file: AuditSourceFile): FileReport {
  const collector = createAuditCollector(file);
  const Babel = (window as any).Babel;
  if (!Babel) {
    const report = collector.getReport();
    report.diagnostics.push('Babel 编译器未准备好，无法分析非 local-iframe 组件源码。');
    return report;
  }

  try {
    // Match the non-local-iframe compile/validation path. The collector is a
    // normal Babel plugin, so TSX syntax and parser behaviour stay consistent
    // with eslintCheckPlugin and other in-browser validators.
    Babel.transform(file.content, {
      filename: file.path,
      presets: [
        ['env', { modules: 'commonjs' }],
        'react',
      ],
      plugins: [
        ['proposal-decorators', { legacy: true }],
        'proposal-class-properties',
        ['transform-typescript', { isTSX: true }],
        collector.plugin,
      ],
      retainLines: true,
    });
  } catch (error) {
    collector.getReport().diagnostics.push(error instanceof Error ? error.message : String(error));
  }

  const report = collector.getReport();

  report.imports = Array.from(new Set(report.imports));
  report.components = Array.from(new Set(report.components));
  report.events = uniqueItems(report.events);
  report.requests = uniqueItems(report.requests);
  report.renderedState = uniqueItems(report.renderedState);
  report.componentReferences = uniqueItems(report.componentReferences);
  return report;
}

function markdownSection(title: string, items: AuditItem[], formatter: (item: AuditItem) => string): string {
  if (!items.length) return `### ${title}\n- 未发现`;
  return `### ${title}\n${items.map((item) => `- ${formatter(item)}`).join('\n')}`;
}

function toMarkdown(reports: FileReport[]): string {
  const imports = reports.flatMap((report) => report.imports.map((name) => ({ name, file: report.path })));
  const components = reports.flatMap((report) => report.components.map((name) => ({ name, file: report.path })));
  const events = reports.flatMap((report) => report.events);
  const requests = reports.flatMap((report) => report.requests);
  const state = reports.flatMap((report) => report.renderedState);
  const refs = reports.flatMap((report) => report.componentReferences);
  const diagnostics = reports.flatMap((report) => report.diagnostics.map((message) => ({ name: message, file: report.path })));
  const locate = (item: AuditItem) => `${item.file}${item.location ? `:${item.location.line}:${item.location.column}` : ''}`;

  return [
    '# 组件静态审计',
    `分析了 ${reports.length} 个源码文件。结果来自 Babel AST；动态调用和运行时条件不会被当作已证实的事实。`,
    markdownSection('组件声明', components, (item) => `\`${item.name}\` — ${locate(item)}`),
    markdownSection('组件引用', refs, (item) => `\`${item.name}\` — ${locate(item)}`),
    markdownSection('事件', events, (item) => `\`${item.name}\` 绑定在 \`${item.target ?? 'root'}\` — ${locate(item)}${item.detail ? `（${item.detail}）` : ''}`),
    markdownSection('接口调用', requests, (item) => `\`${item.name || item.detail || '未知调用'}\` 位于 \`${item.target ?? 'root'}\` — ${locate(item)}`),
    markdownSection('渲染状态', state, (item) => `\`${item.name}\` 渲染在 \`${item.target ?? 'root'}\` — ${locate(item)}`),
    markdownSection('导入依赖', imports, (item) => `\`${item.name}\` — ${item.file}`),
    markdownSection('解析诊断', diagnostics, (item) => `${item.file}：${item.name}`),
  ].join('\n\n');
}

function normalizeRequestedFiles(params: any, files: AuditSourceFile[]): AuditSourceFile[] {
  const requested = [params?.file, ...(Array.isArray(params?.files) ? params.files : [])]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const unique = Array.from(new Set(requested));
  if (!unique.length) return files.filter(isSourceFile);

  const byPath = new Map(files.map((file) => [file.path.replace(/^\.\//, ''), file]));
  return unique.map((path) => byPath.get(path.replace(/^\.\//, ''))).filter((file): file is AuditSourceFile => Boolean(file));
}

function validateGraphFiles(files: AuditSourceFile[], configDirName: string) {
  const normalizedConfigDirName = configDirName.replace(/^\/+|\/+$/g, '');
  const graphPrefix = `${normalizedConfigDirName}/graph/`;
  const graphFiles = files.filter((file) => (
    file.path.replace(/^\.\//, '').startsWith(graphPrefix) && /\.ya?ml$/i.test(file.path)
  ));
  const sourcePaths = new Set(files.filter(isSourceFile).map((file) => file.path.replace(/^\.\//, '')));
  const diagnostics: Array<{ file: string; message: string }> = [];

  if (!graphFiles.length) {
    diagnostics.push({ file: graphPrefix, message: '未找到 YAML 审计文档。' });
  }

  for (const file of graphFiles) {
    let document: unknown;
    try {
      document = parseYaml(file.content);
    } catch (error) {
      diagnostics.push({ file: file.path, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!Array.isArray(document) || !document.length || typeof document[0]?.version !== 'number') {
      diagnostics.push({ file: file.path, message: 'YAML 顶层必须是以 version 开头的节点数组。' });
      continue;
    }
    for (const [index, node] of document.slice(1).entries()) {
      const label = `${file.path} 第 ${index + 2} 项`;
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        diagnostics.push({ file: file.path, message: `${label} 必须是页面、组件或弹窗节点。` });
        continue;
      }
      const value = node as Record<string, unknown>;
      for (const field of ['name', 'fileName', 'title', 'summary', 'type']) {
        if (typeof value[field] !== 'string' || !value[field].trim()) {
          diagnostics.push({ file: file.path, message: `${label} 缺少必填字段 ${field}。` });
        }
      }
      if (typeof value.fileName === 'string' && !sourcePaths.has(value.fileName.replace(/^\.\//, ''))) {
        diagnostics.push({ file: file.path, message: `${label} 的 fileName 未指向现有 TSX/JSX 源码：${value.fileName}。` });
      }
      if (typeof value.type === 'string' && !['page', 'component', 'popup'].includes(value.type)) {
        diagnostics.push({ file: file.path, message: `${label} 的 type 必须为 page、component 或 popup。` });
      }
      for (const field of ['datasource', 'state', 'events']) {
        if (value[field] !== undefined && !Array.isArray(value[field])) {
          diagnostics.push({ file: file.path, message: `${label} 的 ${field} 必须为数组。` });
        }
      }
    }
  }

  return { graphFiles: graphFiles.map((file) => file.path), diagnostics };
}

/** Tool declarations live in plugin-ai; comlib exposes only Babel-backed page analysis. */
export function createBabelPageAnalysis(
  getFiles: SourceProvider,
  options: PageAnalysisOptions,
): {
  understandPage(params: { file: string; profile?: string }): Promise<{ output: string; metadata: Record<string, unknown> }>;
  validatePage(): Promise<{ output: string; metadata: Record<string, unknown> }>;
} {
  const configDirName = options.configDirName.replace(/^\/+|\/+$/g, '');
  if (!configDirName) throw new Error('page-analysis: configDirName is required');
  const understandPage = async (params: { file: string; profile?: string }) => {
      const files = normalizeRequestedFiles(params, await getFiles());
      const reports = files.map(analyzeFile);
      return {
        output: toMarkdown(reports),
        metadata: {
          files: reports.map((report) => report.path),
          componentCount: reports.reduce((sum, report) => sum + report.components.length, 0),
          eventCount: reports.reduce((sum, report) => sum + report.events.length, 0),
          requestCount: reports.reduce((sum, report) => sum + report.requests.length, 0),
          renderedStateCount: reports.reduce((sum, report) => sum + report.renderedState.length, 0),
          diagnosticCount: reports.reduce((sum, report) => sum + report.diagnostics.length, 0),
          reports,
        },
      };
  };

  const validatePage = async () => {
      const files = await getFiles();
      const { graphFiles, diagnostics } = validateGraphFiles(files, configDirName);
      return {
        output: diagnostics.length
          ? `页面文档校验失败：\n${diagnostics.map((item) => `- ${item.file}: ${item.message}`).join('\n')}`
          : `页面文档校验通过：${graphFiles.length} 个 YAML 审计文档均符合基础结构。`,
        metadata: {
          passed: diagnostics.length === 0,
          configDirName,
          graphFiles,
          diagnostics,
        },
      };
  };

  return { understandPage, validatePage };
}
