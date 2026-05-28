/**
 * 只维护这两个数组即可：
 * - 命中 BLACKLIST_ROUTE_PATTERNS => 不显示
 * - 否则命中 WHITELIST_ROUTE_PATTERNS => 显示
 */
const WHITELIST_ROUTE_PATTERNS = [
  /\/design(?:[-/][^?#]*)?(?:[?#]|$)/i,
  /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/\?[^#]*\bid=[^&#]+/i
];

const BLACKLIST_ROUTE_PATTERNS = [
  /\/vibe-app\/[^/?#]+(?:\/)?(?:[?#]|$)/,
  /\/vibe-design\/[^/?#]+(?:\/)?(?:[?#]|$)/,
  /\/mybricks-app-pcspa\/index\.html\?[^#]*\bid=[^&#]+/,
  /\/mybricks-app-weapp-ai\/index\.html\?[^#]*\bid=[^&#]+/
];

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
};

const getRouteCandidates = (parsedUrl: URL) => {
  const candidates = new Set<string>();
  const add = (value?: string | null) => {
    if (!value) return;
    candidates.add(value);
    candidates.add(safeDecode(value));
  };

  add(parsedUrl.href);
  add(`${parsedUrl.pathname}${parsedUrl.search}`);
  add(parsedUrl.hash);
  add(window.location.href);
  add(document.referrer);

  parsedUrl.searchParams.forEach((value) => add(value));

  return Array.from(candidates);
};

const getRuntimeUrl = () => {
  try {
    if (window.top && window.top !== window) {
      return window.top.location.href;
    }
  } catch (_error) {
    // ignore cross-origin access error
  }

  return window.location.href;
};

export function getPathAfterDomain(url: string = getRuntimeUrl()): string {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch (_error) {
    return '';
  }
}

export function shouldShowAiEntry(url?: string): boolean {
  const rawUrl = url ?? getRuntimeUrl();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (_error) {
    return false;
  }
  const routeCandidates = getRouteCandidates(parsedUrl);
  const hitBlacklist = routeCandidates.some((candidate) =>
    BLACKLIST_ROUTE_PATTERNS.some((pattern) => pattern.test(candidate))
  );
  if (hitBlacklist) return false;

  return routeCandidates.some((candidate) =>
    WHITELIST_ROUTE_PATTERNS.some((pattern) => pattern.test(candidate))
  );
}
