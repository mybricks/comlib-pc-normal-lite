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
}

interface Config {
  type: "application" | "component"
}

/**
 * 生成代码文件结构
 * 只导出三个核心文件：runtime.jsx, style.less, store.js
 */
export function generateCodeStructure(data: ComponentData, config: Config): FileItem[] {
  const files: FileItem[] = [];

  data.files.forEach((file) => {
    const { fileName, source } = file;
    if (fileName === "setup.js") {
      return
    }

    files.push({
      fileName,
      content: decodeURIComponent(source)
    })
  })

  return files;
}
