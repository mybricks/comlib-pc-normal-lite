import React from 'react';

const OPENTYPE_CDN = 'https://unpkg.com/opentype.js@1.3.4/dist/opentype.min.js';

interface FontContext {
  font: any;
  fontDigest: Uint8Array;
}

let _cachedFontCtx: FontContext | null = null;
let _fontLoadingPromise: Promise<FontContext | null> | null = null;

function ensureOpentype(): Promise<any> {
  const w = window as any;
  if (w.opentype) return Promise.resolve(w.opentype);
  if (w.__opentypeLoadingPromise) return w.__opentypeLoadingPromise;
  w.__opentypeLoadingPromise = new Promise<any>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OPENTYPE_CDN;
    s.onload = () => {
      delete w.__opentypeLoadingPromise;
      resolve(w.opentype);
    };
    s.onerror = () => {
      delete w.__opentypeLoadingPromise;
      reject(new Error('Failed to load opentype.js'));
    };
    document.head.appendChild(s);
  });
  return w.__opentypeLoadingPromise;
}

async function loadFontContext(): Promise<FontContext | null> {
  if (_cachedFontCtx) return _cachedFontCtx;
  if (_fontLoadingPromise) return _fontLoadingPromise;

  _fontLoadingPromise = (async () => {
    try {
      const ot = await ensureOpentype();
      let fontBuffer: ArrayBuffer | null = null;

      if ('queryLocalFonts' in window) {
        try {
          const fonts: any[] = await (window as any).queryLocalFonts();
          const pingfang = fonts.find(
            (f: any) =>
              f.postscriptName === 'PingFangSC-Regular' ||
              (f.family === 'PingFang SC' && f.style === 'Regular')
          );
          if (pingfang) {
            const blob = await pingfang.blob();
            fontBuffer = await blob.arrayBuffer();
          }
        } catch (_) {
          /* permission denied or API unavailable */
        }
      }

      if (!fontBuffer) {
        const fontUrl = (window as any).__PINGFANG_FONT_URL__;
        if (fontUrl) {
          try {
            const resp = await fetch(fontUrl);
            if (resp.ok) fontBuffer = await resp.arrayBuffer();
          } catch (_) {}
        }
      }

      if (!fontBuffer) {
        console.warn('[字体加载] 未找到 PingFang SC，文本粘贴后需双击显示');
        return null;
      }

      const font = ot.parse(fontBuffer);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', fontBuffer));

      _cachedFontCtx = { font, fontDigest: digest };
      console.log('[字体加载] PingFang SC Regular 加载成功, SHA-1:', Array.from(digest.slice(0, 4)).map((b: number) => b.toString(16).padStart(2, '0')).join(''));
      return _cachedFontCtx;
    } catch (err) {
      console.warn('[字体加载] 失败，文本将需要双击显示', err);
      return null;
    } finally {
      _fontLoadingPromise = null;
    }
  })();

  return _fontLoadingPromise;
}

const SpinIcon = () => {
  React.useEffect(() => {
    if (!document.getElementById('vibeui-spin-keyframes')) {
      const s = document.createElement('style');
      s.id = 'vibeui-spin-keyframes';
      s.textContent = '@keyframes vibeui-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes vibeui-progress-slide{0%{transform:translateX(-120%)}100%{transform:translateX(240%)}}';
      document.head.appendChild(s);
    }
  }, []);

  return (
    <span style={{
      display: 'inline-block',
      width: 12,
      height: 12,
      marginRight: 5,
      verticalAlign: 'middle',
      flexShrink: 0,
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'vibeui-spin 0.7s linear infinite',
      willChange: 'transform',
    }} />
  );
};

interface Props {
  buttonStyle: React.CSSProperties;
  focusArea: any;
  comId: string;
}

interface DirectProgressState {
  percent: number;
  text: string;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function startProgressTrickle(
  setProgress: React.Dispatch<React.SetStateAction<DirectProgressState>>,
  options: { text: string; start: number; max: number; step?: number; intervalMs?: number }
): () => void {
  const { text, start, max, step = 2, intervalMs = 220 } = options;
  let current = start;
  setProgress((prev) => ({ percent: Math.max(prev.percent, start), text }));

  const timer = window.setInterval(() => {
    current = Math.min(max, current + step);
    setProgress((prev) => {
      if (prev.text !== text || prev.percent >= max) return prev;
      return { percent: Math.max(prev.percent, current), text };
    });
  }, intervalMs);

  return () => window.clearInterval(timer);
}

function copyHtmlByExecCommand(html: string): boolean {
  let copied = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', html);
    copied = true;
  };

  document.addEventListener('copy', onCopy);
  try {
    const ok = document.execCommand('copy');
    return copied && ok;
  } catch (_e) {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy);
  }
}

function isNotFocusedClipboardError(err: any): boolean {
  const name = String(err?.name || '').toLowerCase();
  const message = String(err?.message || '').toLowerCase();
  return (
    name.includes('notallowed') ||
    message.includes('not focus') ||
    message.includes('not focused') ||
    message.includes('document is not focused')
  );
}

function waitForDocumentFocus(timeoutMs = 5000): Promise<boolean> {
  if (document.hasFocus() && document.visibilityState === 'visible') {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      resolve(ok);
    };
    const onFocus = () => {
      if (document.hasFocus() && document.visibilityState === 'visible') {
        finish(true);
      }
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    try {
      window.focus();
    } catch (_e) {}
  });
}

async function writeHtmlToClipboard(html: string): Promise<void> {
  const hasClipboardWrite = !!(navigator.clipboard && (window as any).ClipboardItem);
  let lastErr: any = null;
  if (hasClipboardWrite) {
    const clipboardItem = new (window as any).ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([html], { type: 'text/plain' }),
    });
    try {
      await navigator.clipboard.write([clipboardItem]);
      return;
    } catch (err: any) {
      lastErr = err;
      // 导出过程较长时，用户可能已切到 Figma，等待页面重新聚焦后重试一次。
      if (isNotFocusedClipboardError(err)) {
        const regainedFocus = await waitForDocumentFocus(6000);
        if (regainedFocus) {
          await navigator.clipboard.write([clipboardItem]);
          return;
        }
      }
    }
  }

  if (copyHtmlByExecCommand(html)) {
    return;
  }

  if (!hasClipboardWrite) {
    throw new Error('当前环境不支持 ClipboardItem，且 execCommand 复制失败');
  }
  throw lastErr || new Error('写入剪贴板失败');
}

export function ExportFigmaBtn({ buttonStyle, focusArea, comId }: Props) {
  const [directLoading, setDirectLoading] = React.useState(false);
  const [directProgress, setDirectProgress] = React.useState<DirectProgressState>({
    percent: 0,
    text: '准备中...',
  });
  const directProgressRef = React.useRef<DirectProgressState>(directProgress);

  React.useEffect(() => {
    ensureOpentype().catch(() => {});
  }, []);
  React.useEffect(() => {
    directProgressRef.current = directProgress;
  }, [directProgress]);

  const handleDirectPaste = () => {
    if (directLoading) return;
    const fn = (window as any).elementToMybricksJsonWithInlineImages;
    if (typeof fn !== 'function') {
      console.warn('[直接粘贴] window.elementToMybricksJsonWithInlineImages 未定义');
      return;
    }
    const ele = focusArea?.ele;
    if (!ele) {
      console.warn('[直接粘贴] focusArea.ele 不存在');
      return;
    }
    const msg = (window as any).antd?.message;
    const convert = (window as any).convertIRToFigmaClipboardHtml;
    if (typeof convert !== 'function') {
      if (msg) msg.error('Figma 剪切板模块未加载');
      else alert('Figma 剪切板模块未加载');
      return;
    }
    setDirectProgress({ percent: 0, text: '准备中...' });
    setDirectLoading(true);
    const setStage = async (
      percent: number,
      text: string,
      options?: { smooth?: boolean; durationMs?: number }
    ) => {
      const target = Math.max(0, Math.min(percent, 100));
      if (!options?.smooth) {
        setDirectProgress({ percent: target, text });
        await waitForPaint();
        return;
      }
      const from = Math.min(Math.max(directProgressRef.current.percent, 0), target);
      const durationMs = options.durationMs ?? 420;
      if (target <= from || durationMs <= 0) {
        setDirectProgress({ percent: target, text });
        await waitForPaint();
        return;
      }
      await new Promise<void>((resolve) => {
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / durationMs, 1);
          const current = from + (target - from) * progress;
          setDirectProgress({ percent: current, text });
          if (progress >= 1) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await waitForPaint();
    };

    const waitStageWithTrickle = async <T,>(
      options: {
        text: string;
        from: number;
        to: number;
        task: () => Promise<T>;
        intervalMs?: number;
        taskStartDelayMs?: number;
      }
    ): Promise<T> => {
      const { text, from, to, task, intervalMs = 130, taskStartDelayMs = 0 } = options;
      await setStage(from, text, { smooth: true, durationMs: 260 });
      const trickleMax = Math.max(from, to - 1);
      const current = Math.round(Math.min(Math.max(directProgressRef.current.percent, from), trickleMax));
      const start = Math.max(from, current);
      const stopTrickle =
        trickleMax > start
          ? startProgressTrickle(setDirectProgress, {
              text,
              start,
              max: trickleMax,
              step: 1,
              intervalMs,
            })
          : null;
      try {
        if (taskStartDelayMs > 0) {
          await sleep(taskStartDelayMs);
        }
        const result = await task();
        if (stopTrickle) stopTrickle();
        await setStage(to, text, { smooth: true, durationMs: 260 });
        return result;
      } catch (err) {
        if (stopTrickle) stopTrickle();
        throw err;
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        try {
          await setStage(8, '准备字体...');
          const fontCtx = await waitStageWithTrickle({
            text: '加载字体...',
            from: 20,
            to: 30,
            task: () => loadFontContext(),
          });
          await waitStageWithTrickle({
            text: '解析页面结构...',
            from: 30,
            to: 45,
            task: () => sleep(650),
          });
          const irPayload = await waitStageWithTrickle({
            text: '拉取图片资源...',
            from: 45,
            to: 66,
            task: () => fn(ele, comId, { componentLibraryEnabled: false }),
            taskStartDelayMs: 320,
          });
          console.log('[DOM→Figma IR JSON]', JSON.stringify(irPayload, null, 2));
          await setStage(72, '生成 Figma 数据...', { smooth: true, durationMs: 360 });
          const clipboardHtml = convert(irPayload, fontCtx);
          await waitStageWithTrickle({
            text: '写入剪贴板...',
            from: 90,
            to: 98,
            task: () => writeHtmlToClipboard(clipboardHtml),
          });
          await setStage(100, '完成', { smooth: true, durationMs: 280 });
          await sleep(220);
          setDirectLoading(false);
          if (msg) msg.success('已复制，请前往 Figma 直接 Cmd+V / Ctrl+V 粘贴');
          else alert('已复制，请前往 Figma 直接 Cmd+V / Ctrl+V 粘贴');
        } catch (err: any) {
          setDirectLoading(false);
          setDirectProgress({ percent: 0, text: '准备中...' });
          const rawMsg = err?.message || '未知错误';
          const failMsg = isNotFocusedClipboardError(err)
            ? '导出失败：当前页面未聚焦，请先切回页面再重试'
            : '导出失败: ' + rawMsg;
          if (msg) msg.error(failMsg);
          else alert(failMsg);
          console.error('[直接粘贴] 失败', err);
        }
      });
    });
  };
  const progressWidthPercent = Math.min(Math.max(directProgress.percent, 0), 100);
  const progressPercent = Math.round(progressWidthPercent);

  return (
    <div style={{ padding: '4px 0' }}>
      <button
        type="button"
        disabled={directLoading}
        onClick={handleDirectPaste}
        style={{
          ...buttonStyle,
          position: 'relative',
          overflow: 'hidden',
          cursor: directLoading ? 'not-allowed' : 'pointer',
        }}
      >
        {directLoading ? (
          <>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--mybricks-border-color, rgba(0,0,0,0.12))',
                opacity: 0.35,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${progressWidthPercent}%`,
                background: 'var(--mybricks-color-primary, #1677ff)',
                opacity: 0.22,
                transition: 'width 320ms ease-out',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${progressWidthPercent}%`,
                overflow: 'hidden',
                transition: 'width 320ms ease-out',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '35%',
                  height: '100%',
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, transparent, var(--mybricks-color-primary, #1677ff), transparent)',
                  animation: 'vibeui-progress-slide 1.1s linear infinite',
                  pointerEvents: 'none',
                  mixBlendMode: 'screen',
                  opacity: 0.5,
                }}
              />
            </div>
          </>
        ) : null}
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {directLoading ? <><SpinIcon />{directProgress.text} {progressPercent}%</> : '复制到 Figma'}
        </span>
      </button>
      {/* 已按需停用“导出到 Figma（插件）”，当前仅保留剪贴板直贴流程 */}
    </div>
  );
}
