interface CodeTransformParams {
  runtime: string;
  store: string;
  service: string;
  style: string;
}

const STYLE_FILE_NAME = 'index.module.less';

const codeTransform = (params: CodeTransformParams) => {
  let { runtime, store, service, style } = params;

  runtime = runtime.replace(
    /import\s+css\s+from\s+["'](\.\/)?style\.less["']\s*;?/g,
    `import css from './${STYLE_FILE_NAME}';`
  ).replace(
    /from\s+["']mybricks["']/g,
    "from './utils'"
  );

  store = store.replace(
    /from\s+["'](\.\/)?service["']/g,
    "from './service'"
  );

  service = service.replace(
    /from\s+["']mybricks["']/g,
    "from './utils'"
  );

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
    }
  ]
}

export default codeTransform;
