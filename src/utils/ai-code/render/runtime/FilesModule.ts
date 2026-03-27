import { replaceToUnderline } from "./utils";

function runRender(code, dependencies, fileName?: string) {
  const wrapCode = `
    (function(exports,require){
      ${code}
    })
  `

  const exports = {
    default: null
  }

  const require = (packageName) => {
    return dependencies[packageName]
  }

  try {
    eval(wrapCode)(exports, require)
  } catch (e: any) {
    // 构造带有文件位置信息的运行时错误
    const fileLabel = fileName ? `[${fileName}] ` : ''
    const originalMessage = e?.message || String(e)

    // 尝试从错误堆栈中提取行号（eval 内部行号，偏移 2 行的包装代码头）
    let lineInfo = ''
    const stackMatch = e?.stack?.match(/<anonymous>:(\d+):(\d+)/)
    if (stackMatch) {
      const evalLine = parseInt(stackMatch[1], 10)
      // wrapCode 包装头占 2 行，所以实际代码行 = evalLine - 2
      const codeLine = Math.max(1, evalLine - 2)
      lineInfo = ` (第 ${codeLine} 行)`
    }

    const enrichedError: any = new Error(`${fileLabel}${originalMessage}${lineInfo}`)
    enrichedError.originalError = e
    enrichedError.fileName = fileName
    throw enrichedError
  }

  return exports.default
}

class FilesModule {
  /** 文件路径到文件内容映射 */
  filesMap: any = []
  /** 依赖 */
  dependencies: any = {}
  /** 缓存已加载的文件 */
  cache = {}
  /** 导入文件的回调 */
  importCallBack: {
    less: (params: { fileName: string; content: string;}) => void;
  } = {
    less: () => {}
  }

  constructor({ files, dependencies, importCallBack }) {
    this.filesMap = files.reduce((pre, cur) => {
      pre[cur.fileName] = cur
      return pre
    }, {})
    this.dependencies = dependencies
    this.importCallBack = importCallBack
  }

  proxyDependencies(fileName: string) {
    const that = this;
    return new Proxy(this.dependencies, {
      get(target, key: string) {
        if (key in target) {
          return target[key];
        }

        let currentPath = fileName.split('/');
        currentPath = currentPath.slice(0, currentPath.length - 1)
        const targetPath = key.split('/');

        targetPath.forEach((path) => {
          if (path === ".") {
          } else if (path === "..") {
            currentPath.pop();
          } else {
            currentPath.push(path)
          }
        })

        return {
          __esModule: true,
          default: that.getModule(currentPath.join('/')),
        }
      }
    })
  }

  getModule(fileName) {
    const candidates = [fileName, `${fileName}.jsx`, `${fileName}.js`, `${fileName}/index.jsx`, `${fileName}/index.js`];
    let file;
    let resolvedFileName = fileName;
    for (const candidate of candidates) {
      file = this.filesMap[candidate];
      if (file) {
        resolvedFileName = candidate;
        break;
      }
    }

    fileName = resolvedFileName;

    const cacheFileModule = this.cache[fileName];
    if (cacheFileModule) {
      return cacheFileModule;
    }

    if (!file || !file.compiled) {
      return undefined;
    }

    const suffix = fileName.split('.').pop();

    if (suffix === 'jsx' || suffix === 'js') {
      const fileModule: any = runRender(decodeURIComponent(file.compiled), this.proxyDependencies(fileName), fileName);
      return this.cache[fileName] = fileModule;
    } else if (suffix === 'less') {
      this.importCallBack.less({ fileName, content: decodeURIComponent(file.compiled) });
      const prefix = replaceToUnderline(fileName)
      return this.cache[fileName] = new Proxy({}, {
        get(_, key: string) {
          return `${prefix}-${key}`;
        }
      });
    }
  }

  
}

export default FilesModule
