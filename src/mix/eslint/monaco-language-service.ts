import type { StoreDatasourceMap } from './rules/extract-comrefs';

let _storeDatasource: StoreDatasourceMap = {};
let _ctx: MonacoContext | null = null;

export function getLowcodeViewStoreDatasource(): StoreDatasourceMap {
  return _storeDatasource;
}

export async function refreshLowcodeViewStoreDatasource(): Promise<StoreDatasourceMap> {
  if (!_ctx) return _storeDatasource;
  await warmupTypeScriptWorker(_ctx);
  return _storeDatasource;
}

type SourceFile = {
  fileName: string;
  source: string;
};

type MonacoContext = {
  componentId: string;
  monaco: any;
  editor: any;
  files: SourceFile[];
  storeDatasource: StoreDatasourceMap;
  workerReady: boolean;
  lastError?: string;
};

function decodeSource(source: string): string {
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
}

function getUri(monaco: any, componentId: string, fileName: string) {
  return monaco.Uri.parse(`file:///${componentId}/${fileName}`);
}

function ensureModels(monaco: any, componentId: string, files: SourceFile[]) {
  for (const file of files ?? []) {
    if (!file?.fileName) continue;

    const uri = getUri(monaco, componentId, file.fileName);
    const content = decodeSource(file.source ?? '');
    const existing = monaco.editor.getModel(uri);
    if (existing) {
      if (existing.getValue() !== content) existing.setValue(content);
      continue;
    }

    const suffix = file.fileName.split('.').pop() ?? '';
    const language = ['jsx', 'js', 'tsx', 'ts'].includes(suffix) ? 'typescript' : suffix;
    monaco.editor.createModel(content, language, uri);
  }
}

function isCodeUri(uri: string): boolean {
  return /\.(jsx|js|tsx|ts)$/.test(uri);
}

function getModelByUri(monaco: any, uri: string) {
  try {
    return monaco.editor.getModel(monaco.Uri.parse(uri));
  } catch {
    return undefined;
  }
}

function getDefinitionFileName(definition: any): string {
  return definition?.fileName ?? definition?.source ?? '';
}

function sliceNavigationItemText(model: any, item: any): { text: string; start: number } | undefined {
  const span = item?.spans?.[0];
  if (!span) return undefined;

  const text = model.getValue();
  const start = span.start ?? 0;
  const end = start + (span.length ?? 0);
  return {
    text: text.slice(start, end),
    start,
  };
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeout = 1200): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          console.log('[mybricks-eslint][monaco] worker:timeout', label);
          resolve(undefined);
        }, timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function collectStoreDatasourceByMonaco(ctx: MonacoContext, worker: any): Promise<StoreDatasourceMap> {
  const result: Record<string, Set<string>> = {};
  let timeoutCalls = 0;
  const datasourceCallRegex = /\bdataSource\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  const callExpressionRegex = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;

  const addApi = (methodName: string, apiName: string) => {
    if (!methodName || !apiName) return;
    if (!result[methodName]) result[methodName] = new Set<string>();
    result[methodName].add(apiName);
  };

  const scanStoreModel = async (uri: string) => {
    const storeModel = getModelByUri(ctx.monaco, uri);
    if (!storeModel) return;

    const navigationTree = await withTimeout(worker.getNavigationTree(uri), `getNavigationTree:${uri}`);
    if (!navigationTree) {
      timeoutCalls += 1;
      return;
    }

    const visitItem = (item: any) => {
      for (const child of item.childItems ?? []) {
        const methodName = child.text;
        if (!methodName) {
          visitItem(child);
          continue;
        }
        const slice = sliceNavigationItemText(storeModel, child);
        if (slice) {
          let match: RegExpExecArray | null;
          datasourceCallRegex.lastIndex = 0;
          while ((match = datasourceCallRegex.exec(slice.text))) {
            addApi(methodName, match[1]);
          }
          callExpressionRegex.lastIndex = 0;
          let callMatch: RegExpExecArray | null;
          while ((callMatch = callExpressionRegex.exec(slice.text))) {
            const callee = callMatch[1];
            const calledApi = callMatch[2];
            if (callee === 'dataSource') continue;
            const offset = slice.start + callMatch.index + callMatch[0].indexOf(calledApi);
            void withTimeout(
              worker.getDefinitionAtPosition(uri, offset).then((defs: any[]) => {
                const ds = (defs ?? []).find((d: any) => /dataSource\.(jsx|js|tsx|ts)$/.test(getDefinitionFileName(d)));
                if (ds) addApi(methodName, calledApi);
              }),
              `innerDefinition:${uri}:${calledApi}`,
            );
          }
        }
        visitItem(child);
      }
    };

    visitItem(navigationTree);
  };

  const models = ctx.monaco.editor.getModels?.() ?? [];
  for (const model of models) {
    const uri = model.uri.toString();
    if (!uri.startsWith(`file:///${ctx.componentId}/`)) continue;
    if (!isCodeUri(uri)) continue;
    if (!/store\.(jsx|js|tsx|ts)$/.test(uri)) continue;
    await scanStoreModel(uri);
  }

  const storeDatasource = Object.entries(result).reduce<StoreDatasourceMap>((acc, [methodName, apis]) => {
    acc[methodName] = Array.from(apis);
    return acc;
  }, {});

  if (timeoutCalls > 0) {
    console.log('[mybricks-eslint][monaco] collect:timeouts', timeoutCalls);
  }

  return storeDatasource;
}

async function warmupTypeScriptWorker(ctx: MonacoContext) {
  const getWorker = ctx.monaco.languages?.typescript?.getTypeScriptWorker;
  if (!getWorker) {
    ctx.workerReady = false;
    ctx.lastError = 'monaco.languages.typescript.getTypeScriptWorker 不存在';
    return;
  }

  ensureModels(ctx.monaco, ctx.componentId, ctx.files);

  const firstCodeFile = ctx.files.find(file => /\.(jsx|js|tsx|ts)$/.test(file.fileName));
  if (!firstCodeFile) {
    ctx.workerReady = false;
    ctx.lastError = '没有可分析的 JS/TS 文件';
    return;
  }

  const uri = getUri(ctx.monaco, ctx.componentId, firstCodeFile.fileName);
  const workerGetter = await getWorker();
  const worker = await workerGetter(uri);

  ctx.workerReady = true;
  ctx.lastError = undefined;

  try {
    ctx.storeDatasource = await collectStoreDatasourceByMonaco(ctx, worker);
    _storeDatasource = ctx.storeDatasource;
  } catch (error) {
    ctx.lastError = (error as any)?.message ?? String(error);
  }
}

export function registerLowcodeViewMonacoContext(params: {
  componentId: string;
  monaco: any;
  editor: any;
  files: SourceFile[];
}) {
  const ctx: MonacoContext = {
    ...params,
    storeDatasource: {},
    workerReady: false,
  };

  _ctx = ctx;
  warmupTypeScriptWorker(ctx).catch((error) => {
    ctx.workerReady = false;
    ctx.lastError = (error as any)?.message ?? String(error);
  });

  return ctx;
}
