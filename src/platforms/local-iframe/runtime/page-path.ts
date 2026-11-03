export function normalizeBasePath(basePath: string): string {
  const normalized = basePath.trim()
  if (!normalized || normalized === '/') return ''
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withLeadingSlash.replace(/\/+$/, '')
}

export function getPagePathWithBase(path: string): string {
  const routePath = path && !path.startsWith('/') ? `/${path}` : path
  const routerBasename = normalizeBasePath(window.__LINGCHUANG_CONFIG__?.router?.basename || '')
  return `${routerBasename}${routePath === '/' ? '' : routePath}` || '/'
}
