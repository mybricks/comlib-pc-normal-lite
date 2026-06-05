export type RuntimeViewMode = 'design' | 'runtime';

export type ParsedRuntimeMode = {
  runtimeMode?: string;
  viewMode: RuntimeViewMode;
  comId?: string;
  dataEnv?: string;
};

const EDIT_SUFFIX = '_edit';
const RUNTIME_SEPARATOR = '_runtime_';

export function createRuntimeMode(comId: string, edit: boolean, activeEnv: string): string {
  return edit ? `${comId}${EDIT_SUFFIX}` : `${comId}${RUNTIME_SEPARATOR}${activeEnv}`;
}

export function parseRuntimeMode(runtimeMode?: string): ParsedRuntimeMode {
  if (!runtimeMode) {
    return { runtimeMode, viewMode: 'design' };
  }

  if (runtimeMode.endsWith(EDIT_SUFFIX)) {
    return {
      runtimeMode,
      viewMode: 'design',
      comId: runtimeMode.slice(0, -EDIT_SUFFIX.length),
    };
  }

  const runtimeIndex = runtimeMode.lastIndexOf(RUNTIME_SEPARATOR);
  if (runtimeIndex >= 0) {
    return {
      runtimeMode,
      viewMode: 'runtime',
      comId: runtimeMode.slice(0, runtimeIndex),
      dataEnv: runtimeMode.slice(runtimeIndex + RUNTIME_SEPARATOR.length),
    };
  }

  return { runtimeMode, viewMode: 'design' };
}

export function formatRuntimeModeLabel(runtimeMode?: string): string {
  const parsed = parseRuntimeMode(runtimeMode);
  if (parsed.viewMode === 'design') {
    return '设计态';
  }

  return parsed.dataEnv ? `运行态(${parsed.dataEnv}环境)` : '运行态';
}
