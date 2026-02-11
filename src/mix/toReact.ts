/** 非标准 style，仅支持部分合法字段，出码时需转换 */
export type ToReactStyleInput = {
  width?: number | string;
  height?: number | string;
  [key: string]: unknown;
};

interface ToReactParams {
  id: string;
  /** 组件标题（可含中文、特殊符号），用于生成更语义化的 componentName */
  title?: string;
  data: {
    componentConfig?: string;
    configJsCompiled?: string;
    configJsSource?: string;
    modelConfig?: string;
    runtimeJsxCompiled?: string;
    runtimeJsxSource?: string;
    styleCompiled?: string;
    styleSource?: string;
    _cssErr?: string;
    _jsxErr?: string;
  };
  style?: ToReactStyleInput;
  events?: any;
}

interface FileItem {
  name: string;
  content: string;
}

interface ToReactResult {
  jsx: string;
  componentName: string;
  files: FileItem[];
}

/** 允许透传到 React style 的合法 key，后续可扩展 */
const ALLOWED_STYLE_KEYS = ['width', 'height'] as const;

/**
 * 将非标准 style 转为合法 React 内联 style 对象（仅保留允许的 key，数字补 px）
 */
export function toReactStyle(style: ToReactStyleInput | undefined): Record<string, string | number> {
  if (!style || typeof style !== 'object') return {};
  return style as Record<string, string | number>;
  // const out: Record<string, string | number> = {};
  // for (const key of ALLOWED_STYLE_KEYS) {
  //   const v = style[key];
  //   if (v === undefined || v === null) continue;
  //   if (typeof v === 'number') out[key] = `${v}px`;
  //   else if (typeof v === 'string') out[key] = v;
  // }
  // return out;
}

/**
 * 将 style 转为可拼进 JSX 的字符串，例如: { width: '100px', height: '200px' }
 * 用于拼接成 style={...} 的表达式部分
 */
export function toReactStyleJsxString(style: ToReactStyleInput | undefined): string {
  const obj = toReactStyle(style);
  if (Object.keys(obj).length === 0) return '{}';
  const entries = Object.entries(obj).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `{ ${entries.join(', ')} }`;
}

/**
 * 生成组件名：id 可能含小写、数字、特殊字符，需转为 React 合法组件名（首字母必须大写）
 * 本身已是合法组件名（大写字母开头 + 字母数字）则不转换；否则用 Com 前缀（无下划线）
 */
function generateComponentName(id: string): string {
  // 已是合法 React 组件名：首字母大写 + 仅字母数字
  if (/^[A-Z][a-zA-Z0-9]*$/.test(id)) return id;

  const cleaned = id
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!cleaned) return 'Com';
  const first = cleaned.charAt(0);
  if (/[a-z]/.test(first)) {
    return first.toUpperCase() + cleaned.slice(1);
  }
  if (/[A-Z]/.test(first)) {
    return cleaned;
  }
  return 'Com' + cleaned;
}

/** 安全解码：先 decodeURIComponent，失败则返回原串 */
function safeDecode(str: string | undefined): string {
  if (str == null || str === '') return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * 解码组件配置字符串（先 safeDecode 再 JSON.parse）
 */
function decodeConfig(configStr?: string): any {
  const raw = safeDecode(configStr);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to decode config:', e);
    return {};
  }
}

export default function toReact({ id, title, data, style, events }: ToReactParams): ToReactResult {
  const files: FileItem[] = [];

  // 所有文件内容统一 decode
  const runtimeJsxSource = safeDecode(data.runtimeJsxSource || '') || '';
  const styleSourceDecoded = safeDecode(data.styleSource || data.styleCompiled || '') || '';
  const configJsSourceRaw = safeDecode(data.configJsSource || '');
  const modelConfigRaw = safeDecode(data.modelConfig || '');
  const componentConfig = decodeConfig(data.componentConfig || '{}') || {};
  const componentName = componentConfig.name || generateComponentName(id)

  // 1. 处理组件主文件 (index.tsx)
  // 第一步：替换 export default 为内部函数
  const innerComponentName = 'InnerComponent';
  // let codeWithoutExport = runtimeJsxSource.replace(
  //   /export\s+default\s+forwardRef/,
  //   `const ${innerComponentName} = forwardRef`
  // );
  let codeWithoutExport = runtimeJsxSource;

  // runtime 固定写法 import css from "style.less" / 'style.less' / "style.less"; 等 -> 标准 CSS Module
  codeWithoutExport = codeWithoutExport.replace(
    /import\s+css\s+from\s+["']style\.less["']\s*;?/g,
    `import styles from './style.module.less';`
  );
  codeWithoutExport = codeWithoutExport.replace(/\bcss\./g, 'styles.');

  // 第二步：文件最后追加新的 export default 带 div wrap（不带 style）
  // 添加 title 作为 JSDoc 注释
  // const titleComment = title ? `/**\n * ${title}\n */\n` : '';
//   const componentContent = `${codeWithoutExport}

// ${titleComment}export default forwardRef(function (props, ref) {
//   const { className, style, ...rest } = props;

//   useSubjectImperativeHandle(ref);

//   return (
//     <div className={className} style={style}>
//       <${innerComponentName} {...rest} ref={ref} />
//     </div>
//   );
// });
// `;
  
  files.push({
    name: 'index.tsx',
    content: codeWithoutExport.trim()
  });

  // 2. 处理样式文件 (style.module.less)
  files.push({
    name: 'style.module.less',
    content: styleSourceDecoded
  });

  // 3. 生成父级使用的 JSX：展开 model.json 和 style 的内容到 props
  const propsArray: string[] = [];
  
  // 先添加 style 到 props（放在最前面）
  const styleObj = toReactStyle(style);
  if (Object.keys(styleObj).length > 0) {
    propsArray.push(`style={${toReactStyleJsxString(style)}}`);
  }
  
  // 从 model.json 中获取所有字段并展开到 props（转换为对象字面量格式）
  if (modelConfigRaw) {
    try {
      const modelConfig = JSON.parse(modelConfigRaw);
      Object.keys(modelConfig).forEach(key => {
        const value = modelConfig[key];
        // 将 JSON 转换为对象字面量格式
        const valueStr = JSON.stringify(value, null, 0)
          .replace(/"([^"]+)":/g, '$1:'); // 移除属性名的引号
        propsArray.push(`${key}={${valueStr}}`);
      });
    } catch (e) {
      console.error('Failed to parse modelConfig:', e);
    }
  }

  const jsx = `<${componentName} ref={${id}Ref} ${propsArray.join(' ')} ${componentConfig.outputs?.length ? componentConfig.outputs.reduce((pre, output) => {
    return pre + events[output.id]
  }, "") : ""}/>`;

  return {
    jsx,
    componentName,
    files
  };
}