/**
 * 将 manifest 中的相对本地路径（如 ./asserts/...）转换为 webview 可访问的 URI。
 *
 * VSCode webview 使用 vscode-webview:// 协议，相对路径无法直接解析。
 * 扩展侧在 _getWebviewContent 中注入了 window.__WEBVIEW_URI_MAP__，
 * 提供了 asserts / out 目录的 webview URI 基址。
 *
 * 如果 URL 不是本地相对路径（http/https/blob/data 等），则原样返回。
 */
export function resolveLocalUrl(url: string): string {
  if (!url) return url
  // 已经是绝对 URL，直接返回
  if (/^(https?:|blob:|data:|vscode-webview:)/i.test(url)) return url
  const uriMap = (window as any).__WEBVIEW_URI_MAP__
  if (!uriMap) {
    return url
  }
  // ./asserts/xxx → asserts 基址 + xxx
  const assertsMatch = url.match(/^\.\/asserts\/(.+)$/)
  if (assertsMatch) return uriMap.asserts + '/' + assertsMatch[1]
  // ./out/webview/xxx → out 基址 + xxx
  const outMatch = url.match(/^\.\/out\/webview\/(.+)$/)
  if (outMatch) return uriMap.out + '/' + outMatch[1]
  return url
}