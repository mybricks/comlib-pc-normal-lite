let _ctx: MonacoContext | null = null;

export function getLowcodeViewStoreDatasource(): Record<string, never> {
  return {};
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

async function warmupTypeScriptWorker(ctx: MonacoContext) {
  const getWorker = ctx.monaco.languages?.typescript?.getTypeScriptWorker;
  if (!getWorker) {
    ctx.workerReady = false;
    ctx.lastError = 'monaco.languages.typescript.getTypeScriptWorker 不存在';
    return;
  }

  ensureModels(ctx.monaco, ctx.componentId, ctx.files);

  ctx.workerReady = true;
  ctx.lastError = undefined;
}

export function registerLowcodeViewMonacoContext(params: {
  componentId: string;
  monaco: any;
  editor: any;
  files: SourceFile[];
}) {
  const ctx: MonacoContext = {
    ...params,
    workerReady: false,
  };

  _ctx = ctx;
  warmupTypeScriptWorker(ctx).catch((error) => {
    ctx.workerReady = false;
    ctx.lastError = (error as any)?.message ?? String(error);
  });

  return ctx;
}
