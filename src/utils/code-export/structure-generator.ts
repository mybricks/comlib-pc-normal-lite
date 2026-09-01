import { tramsform } from "./codeTransform";

/**
 * 代码结构生成器
 * 负责将组件数据按照代码结构生成并组织文件
 */
export interface FileItem {
  /** 文件名（包含相对路径，如 runtime.jsx） */
  fileName: string;
  /** 文件内容 */
  content: string;
}

export interface ComponentData {
  files: {
    /** 文件名 */
    fileName: string;
    /** 文件源码（经过 base64 编码） */
    source: string;
  }[]
  themes: {
    themes: {
      id: string;
      name: string;
      vars: {
        propertyName: string;
        value: string;
        title: string;
        type: string;
      }[]
    }[]
  }
}

/**
 * @deprecated
 */
interface Config {
  type: "application" | "component"
  previous?: boolean
}

// [TEMP] 临时兼容，后续删除
const tempFN = (data: ComponentData) => {
  return data.files.map(({ fileName, source }) => {
    return {
      fileName,
      content: decodeURIComponent(source)
    }
  })
  const files: FileItem[] = [];

  data.files.forEach((file) => {
    const { fileName, source } = file;
    if (fileName === "setup.js") {
      return
    }

    let code = decodeURIComponent(source);
    let name = fileName;

    const suffix = fileName.split('.').pop()
    if(suffix === 'jsx' || suffix === 'js') {
      code = tramsform(code)
    } else if (suffix === 'less') {
      name = name.replace('.less', '.module.less')
    }

    files.push({
      fileName: name,
      content: code
    })
  })

  return files;
}

export function generateCodeStructure(data: ComponentData, config: Config): FileItem[] {

  if (config.previous) {
    return tempFN(data)
  }

  const files: FileItem[] = [];

  data.files.forEach((file) => {
    const { fileName, source } = file;
    if (fileName === "setup.js") {
      return
    }

    let code = decodeURIComponent(source);
    let name = fileName;

    const suffix = fileName.split('.').pop()
    if(suffix === 'jsx' || suffix === 'js') {
      code = tramsform(code)
    } else if (suffix === 'less') {
      name = name.replace('.less', '.module.less')
    }

    files.push({
      fileName: `src/${name}`,
      content: code
    })
  })

  files.push(themesFile(data))
  files.push(entryFile())

  return files;
}

const themesFile = (data: ComponentData) => {
  const themes = data.themes.themes.reduce((pre, theme) => {
    pre[theme.id] = theme.vars.reduce((pre, cssVar) => {
      pre[cssVar.propertyName] = cssVar.value;
      return pre;
    }, {})
    return pre;
  }, {});

  return {
    fileName: 'themes.js',
    content: `export default ${JSON.stringify(themes, null, 2)}`
  }
}

const entryFile = () => {
  return {
    fileName: 'index.jsx',
    content: `import { ConfigProvider } from '@mybricks/ai-render'
import App from './src'
import themes from './themes'

export default function (props) {
  return (
    <ConfigProvider themes={themes} {...props}>
      <App />
    </ConfigProvider>
  )
}
`
  }
}