/** 缺失文件的详细信息 */
export interface MissingFileInfo {
  /** 依赖该文件的文件列表 */
  dependedBy: string[]
}

/**
 * 从 tempFilesMap 中提取真正缺失的文件列表及详细信息
 * 
 * 系统在查找文件时会尝试多种路径组合（如添加不同扩展名、/index后缀等）
 * 此函数将这些尝试的路径归类，找出真正缺失的基础文件，并提取依赖关系信息
 * 
 * @example
 * // 输入：
 * // { 
 * //   "pages/Home.jsx": { dependedBy: Set(['index.jsx']), ... },
 * //   "pages/Home.jsx.jsx": { dependedBy: Set(['index.jsx']), ... }
 * // }
 * // 输出：
 * // { 
 * //   "pages/Home.jsx": { 
 * //     dependedBy: ["index.jsx"] 
 * //   } 
 * // }
 * 
 * @param tempFilesMap - 包含所有尝试过的文件路径的映射表
 * @returns 缺失文件的详细信息对象，key 为推荐的文件路径，value 包含依赖关系信息
 */
export function extractMissingFiles(tempFilesMap: Record<string, any>): Record<string, MissingFileInfo> {
  const allPaths = Object.keys(tempFilesMap)
  
  if (allPaths.length === 0) {
    return {}
  }
  
  const groupedPaths = new Map<string, string[]>()
  
  // 辅助函数：迭代移除扩展名和/index，直到路径不再变化
  const getBasePath = (path: string): string => {
    let current = path
    let previous = ''
    
    while (current !== previous) {
      previous = current
      // 移除 .jsx/.tsx/.js/.ts 扩展名
      current = current.replace(/\.(jsx?|tsx?)$/, '')
      // 移除 /index 后缀
      current = current.replace(/\/index$/, '')
    }
    
    return current
  }
  
  // 按基础路径分组
  allPaths.forEach((path) => {
    const basePath = getBasePath(path)
    
    if (!groupedPaths.has(basePath)) {
      groupedPaths.set(basePath, [])
    }
    groupedPaths.get(basePath)!.push(path)
  })
  
  // 从每组中选择最短的路径作为推荐的文件名，并提取依赖关系信息
  return Array.from(groupedPaths.entries()).reduce((result, [basePath, paths]) => {
    const shortestPath = paths.reduce((shortest, current) => 
      current.length < shortest.length ? current : shortest
    )
    
    // 从任一路径提取 dependedBy 信息（同组路径的 dependedBy 应该相同）
    const firstPathEntry = tempFilesMap[paths[0]]
    result[shortestPath] = firstPathEntry
    
    return result
  }, {} as Record<string, MissingFileInfo>)
}
