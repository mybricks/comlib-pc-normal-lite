import { getAllLibraryResources, type LibraryResource } from '../availableLibraries';

/**
 * 按顺序加载单个资源（JS 或 CSS）。
 * - JS：若已存在对应的 globalVar 则跳过，否则注入 <script> 等待加载完成
 * - CSS：通过 <link> 注入，重复 url 跳过
 */
function loadResource(resource: LibraryResource): Promise<void> {
  const { type, url, globalVar } = resource;

  if (type === 'js') {
    if (globalVar && (window as any)[globalVar] != null) {
      return Promise.resolve();
    }
    if (document.querySelector(`script[src="${url}"]`)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => {
        console.warn(`[loadResource] 加载 JS 资源失败: ${url}`);
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  if (type === 'css') {
    if (document.querySelector(`link[href="${url}"]`)) {
      return Promise.resolve();
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
    return Promise.resolve();
  }

  return Promise.resolve();
}

/**
 * 加载所有需要外部资源的库。
 * 每个库内部的资源按顺序串行加载（保证依赖顺序），不同库之间并行。
 */
async function loadAllLibraryResources() {
  const libs = getAllLibraryResources();
  await Promise.all(
    libs.map(async ({ name, resources }) => {
      for (const resource of resources) {
        await loadResource(resource);
      }
    })
  );
}

loadAllLibraryResources().catch((err) => {
  console.warn('[loadAllLibraryResources] 外部资源加载出错:', err);
});
