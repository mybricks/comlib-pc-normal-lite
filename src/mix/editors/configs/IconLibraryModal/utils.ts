import context from '../../../context';

export type DumpIconItem = {
  id?: string;
  name: string;
  svg: string;
};

export type DumpIconsLibrary = {
  id: string;
  name?: string;
  updatedAt?: number;
  icons: DumpIconItem[];
};

export type IconPanel = 'overview' | 'detail';

export function normalizeLibraries(libraries: any): DumpIconsLibrary[] {
  if (!Array.isArray(libraries)) return [];
  return libraries
    .map((library: any) => {
      const icons = Array.isArray(library?.icons)
        ? library.icons.filter((icon: any) => icon?.name && icon?.svg)
        : [];
      return {
        id: String(library?.id ?? ''),
        name: library?.name ?? '',
        updatedAt: Number(library?.updatedAt ?? 0),
        icons,
      };
    })
    .filter((library: DumpIconsLibrary) => library.id);
}

/**
 * 删除指定图标库。
 * 优先走应用通过 componentRuntime 透传的 deleteIconsLibrary，拿不到则静默忽略（由调用方更新本地 state）。
 */
export async function deleteIconLibrary(id: string): Promise<void> {
  const componentRuntime = (window as any)._sandbox_?.config?.componentRuntime;
  const deleteFn = componentRuntime?.deleteIconsLibrary;
  if (typeof deleteFn === 'function') {
    await deleteFn(id);
  }
}

/**
 * 读取图标库数组。
 * 优先走应用通过 componentRuntime 透传的 getIconsLibraries（实时拿 ref，AI 新生成的也能拿到），
 * 拿不到再回退到组件 dump 里的 iconsState.libraries。
 */
export async function loadIconLibraries(comId: string): Promise<DumpIconsLibrary[]> {
  const componentRuntime = (window as any)._sandbox_?.config?.componentRuntime;
  const getIconsLibraries = componentRuntime?.getIconsLibraries;
  if (typeof getIconsLibraries === 'function') {
    try {
      const normalized = normalizeLibraries(await getIconsLibraries());
      if (normalized.length > 0) return normalized;
    } catch (e) {
      console.error('[svgEditor] componentRuntime.getIconsLibraries failed:', e);
    }
  }
  const aiComParams = context.component?.params;
  return normalizeLibraries(aiComParams?.data?.iconsState?.libraries);
}
