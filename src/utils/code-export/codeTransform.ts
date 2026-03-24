interface CodeTransformParams {
  runtime: string;
  store: string;
  service: string;
  style: string;
}

interface Config {
  type: "application" | "component"
}

const CONTEXT_JS = {
  path: 'context.js',
  content: `import {
  createRefs,
  createRouter,
  PopupVisible,
  logger
} from '@mybricks/ai-render';
import Store from './store';

const {
  appRef,
  pageRef,
  comRef,
  popupRef
} = createRefs({ Store });

const {
  Routes,
  Route,
  useParams,
  useNavigate,
  useLocation
} = createRouter({ type: '--replace-createRouter-type--' });

export {
  appRef,
  pageRef,
  comRef,
  popupRef,
  Routes,
  Route,
  useNavigate,
  useParams,
  useLocation,
  PopupVisible,
  logger
};
`
}

const STYLE_FILE_NAME = 'index.module.less';

const removeNamedImport = (code: string, name: string): string => {
  return code.replace(
    /^import\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])\s*;?\n?/gm,
    (match, bindings: string, source: string) => {
      const names = bindings.split(',').map(s => s.trim()).filter(s => s && s !== name);
      if (names.length === 0) return '';
      return `import { ${names.join(', ')} } from ${source};\n`;
    }
  );
};

const codeTransform = (params: CodeTransformParams, config: Config) => {
  let { runtime, store, service, style } = params;
  const { type } = config;

  runtime = runtime.replace(
    /import\s+css\s+from\s+["'](\.\/)?style\.less["']\s*;?/g,
    `import css from './${STYLE_FILE_NAME}';`
  ).replace(
    /from\s+["']mybricks["']/g,
    "from './context'"
  );

  store = store.replace(
    /from\s+["'](\.\/)?service["']/g,
    "from './service'"
  ).replace(
    /from\s+["']mybricks["']/g,
    "from './context'"
  ).replace(/@PopupVisible/g, "");
  store = removeNamedImport(store, 'PopupVisible');

  service = service.replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"]mybricks['"];?\s*\n?/, "");

  service = `import { createAPIClient } from "@mybricks/ai-render"` +
  `\n\nconst { createEnvs, createAPI } = createAPIClient();` +
  `\n\n${service}`

  return [
    {
      path: 'index.jsx',
      content: runtime,
    },
    {
      path: STYLE_FILE_NAME,
      content: style,
    },
    {
      path: 'store.js',
      content: store,
    },
    {
      path: 'service.js',
      content: service,
    },
    {
      path: CONTEXT_JS.path,
      content: CONTEXT_JS.content.replace('--replace-createRouter-type--', type)
    }
  ]
}

export default codeTransform;
