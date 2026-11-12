/** Playground injects the launch mode before loading the component library. */
export function isCliLaunch(): boolean {
  return window.__LINGCHUANG_CONFIG__?.launchMode === 'cli'
}
