/**
 * 知识库管理器
 */

import { KnowledgeNode, IProviderManager } from './knowledge-node';
import { 
  KnowledgeNodeType, 
  KnowledgeBaseConfig, 
  ExportOptions,
  IDirectoryProvider,
  IKnowledgeNode,
  DynamicDocument,
  DynamicDocDirectoryConfig,
  IFileInfo
} from './types';

/**
 * 知识库类
 * 本质上是对一条大模型消息的生成和管理
 */
export class KnowledgeBase implements IProviderManager {
  /** 知识库名称 */
  name: string;
  
  /** 知识库描述 */
  description?: string;
  
  /** 根节点 */
  private root: KnowledgeNode;
  
  /** 已打开的文件路径列表 */
  private openedFilePaths: Set<string> = new Set();

  /** 注册的 Provider 映射 */
  private providers: Map<string, IDirectoryProvider> = new Map();

  /** 动态文档目录配置映射 */
  private dynamicDirectories: Map<string, DynamicDocDirectoryConfig> = new Map();

  /** 动态文档存储（按目录ID分组） */
  private dynamicDocuments: Map<string, Map<string, DynamicDocument>> = new Map();

  /** 默认动态文档目录ID */
  private readonly DEFAULT_DYNAMIC_DIR_ID = '__dynamic_docs__';

  constructor(config: KnowledgeBaseConfig) {
    this.name = config.name;
    this.description = config.description;

    // 初始化根节点
    this.root = new KnowledgeNode(
      '__root__',
      this.name,
      KnowledgeNodeType.DIRECTORY,
      this,
      {
        description: this.description,
        metadata: { providerId: '__root__' }
      }
    );
  }

  /**
   * 注册目录提供者
   */
  registerProvider(provider: IDirectoryProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * 注册动态文档目录
   */
  registerDynamicDirectory(config: DynamicDocDirectoryConfig): void {
    this.dynamicDirectories.set(config.id, config);
    // 为这个目录初始化文档存储
    if (!this.dynamicDocuments.has(config.id)) {
      this.dynamicDocuments.set(config.id, new Map());
    }
  }

  /**
   * 获取 Provider（实现 IProviderManager 接口）
   */
  getProvider(providerId: string): IDirectoryProvider | undefined {
    // 根节点特殊处理
    if (providerId === '__root__') {
      return {
        id: '__root__',
        name: this.name,
        description: this.description,
        weight: 0,
        getRootNode: () => ({ id: '__root__', name: this.name, type: KnowledgeNodeType.DIRECTORY }),
        getChildren: async () => {
          // 返回所有注册的 provider 和动态文档目录的根节点，按权重排序（从大到小）
          const allNodes: IKnowledgeNode[] = [];
          
          // 添加 provider 节点
          const providers = Array.from(this.providers.values());
          allNodes.push(...providers.map(p => p.getRootNode()));
          
          // 添加动态文档目录节点
          const dynamicDirs = Array.from(this.dynamicDirectories.values());
          allNodes.push(...dynamicDirs.map(dir => ({
            id: dir.id,
            name: dir.name,  // 直接使用 name 作为展示名称
            type: KnowledgeNodeType.DIRECTORY,
            description: dir.description,
            hidden: dir.hidden,
            metadata: { 
              providerId: dir.id,  // 使用自己的 ID 作为 providerId，确保子节点查找正确
              isDynamicDirectory: true
            }
          })));
          
          // 按权重排序（从大到小）
          allNodes.sort((a, b) => {
            const weightA = this.getNodeWeight(a.id);
            const weightB = this.getNodeWeight(b.id);
            return weightB - weightA;
          });
          
          return allNodes;
        },
        readFile: async (fileInfo: IFileInfo) => {
          throw new Error('Cannot read file from root');
        }
      } as IDirectoryProvider;
    }
    
    // 检查是否是动态文档目录
    if (this.dynamicDirectories.has(providerId)) {
      return this.createDynamicDirectoryProvider(providerId);
    }
    
    return this.providers.get(providerId);
  }

  /**
   * 获取节点的权重
   */
  private getNodeWeight(nodeId: string): number {
    const provider = this.providers.get(nodeId);
    if (provider) {
      return provider.weight ?? 0;
    }
    const dynamicDir = this.dynamicDirectories.get(nodeId);
    if (dynamicDir) {
      return dynamicDir.weight ?? 0;
    }
    return 0;
  }

  /**
   * 为动态文档目录创建 Provider
   */
  private createDynamicDirectoryProvider(directoryId: string): IDirectoryProvider {
    const dirConfig = this.dynamicDirectories.get(directoryId);
    if (!dirConfig) {
      throw new Error(`Dynamic directory not found: ${directoryId}`);
    }

    return {
      id: dirConfig.id,
      name: dirConfig.name,
      description: dirConfig.description,
      weight: dirConfig.weight ?? 0,
      getRootNode: () => ({
        id: dirConfig.id,
        name: dirConfig.name,  // 直接使用 name 作为展示名称
        type: KnowledgeNodeType.DIRECTORY,
        description: dirConfig.description,
        hidden: dirConfig.hidden,
        metadata: { 
          isDynamicDirectory: true
        }
      }),
      getChildren: async (parentId: string) => {
        if (parentId !== dirConfig.id) {
          return [];
        }
        // 返回该目录下的所有动态文档
        const docs = this.dynamicDocuments.get(directoryId);
        if (!docs) {
          return [];
        }
        return Array.from(docs.values()).map(doc => ({
          id: doc.id,  // 简单的 id，用于路径匹配
          name: doc.title || doc.id,  // 使用 title 作为展示名称
          type: KnowledgeNodeType.FILE,
          extname: doc.extname || '.md',
          description: doc.description,  // description 就是描述
          hidden: dirConfig.hidden,
          metadata: { 
            isDynamicDocument: true,
            directoryId,
            docId: doc.id
            // parentPath 会由 getChildren() 自动传递
          }
        }));
      },
      readFile: async (fileInfo: IFileInfo) => {
        // path 格式: directoryId/docId
        const match = fileInfo.path.match(/^(.+)\/(.+)$/);
        if (!match) {
          throw new Error(`Invalid dynamic document file path: ${fileInfo.path}`);
        }
        const [, dirId, docId] = match;
        const docs = this.dynamicDocuments.get(dirId);
        const doc = docs?.get(docId);
        if (!doc) {
          throw new Error(`Dynamic document not found: ${fileInfo.path}`);
        }
        
        let result = '';
        if (doc.title) {
          result += `## ${doc.title}\n`;
        }
        if (doc.description) {
          result += `> ${doc.description}\n\n`;
        }
        result += doc.content;
        return result;
      }
    };
  }

  /**
   * 添加动态文档
   * @param doc 动态文档
   */
  addDynamicDocument(doc: DynamicDocument): void {
    const directoryId = doc.directoryId || this.DEFAULT_DYNAMIC_DIR_ID;
    
    // 确保目录存在
    if (!this.dynamicDirectories.has(directoryId)) {
      // 如果是默认目录且不存在，自动创建
      if (directoryId === this.DEFAULT_DYNAMIC_DIR_ID) {
        this.registerDynamicDirectory({
          id: this.DEFAULT_DYNAMIC_DIR_ID,
          name: '动态文档',
          description: '动态生成的文档',
          weight: -100,
          hidden: true
        });
      } else {
        throw new Error(`Dynamic directory not found: ${directoryId}`);
      }
    }

    // 获取或创建该目录的文档存储
    let docs = this.dynamicDocuments.get(directoryId);
    if (!docs) {
      docs = new Map();
      this.dynamicDocuments.set(directoryId, docs);
    }

    // 添加文档
    docs.set(doc.id, doc);
  }

  /**
   * 删除动态文档
   * @param docId 文档ID
   * @param directoryId 目录ID（可选，如果不指定则搜索所有目录）
   */
  removeDynamicDocument(docId: string, directoryId?: string): void {
    if (directoryId) {
      // 从指定目录删除
      const docs = this.dynamicDocuments.get(directoryId);
      if (docs) {
        docs.delete(docId);
        // 同时关闭该文档（如果已打开）
        const path = `${directoryId}/${docId}`;
        this.closeFile(path);
      }
    } else {
      // 从所有目录中搜索并删除
      for (const [dirId, docs] of this.dynamicDocuments.entries()) {
        if (docs.has(docId)) {
          docs.delete(docId);
          const path = `${dirId}/${docId}`;
          this.closeFile(path);
        }
      }
    }
  }

  /**
   * 获取动态文档
   * @param docId 文档ID
   * @param directoryId 目录ID（可选）
   */
  getDynamicDocument(docId: string, directoryId?: string): DynamicDocument | undefined {
    if (directoryId) {
      return this.dynamicDocuments.get(directoryId)?.get(docId);
    } else {
      // 搜索所有目录
      for (const docs of this.dynamicDocuments.values()) {
        const doc = docs.get(docId);
        if (doc) {
          return doc;
        }
      }
    }
    return undefined;
  }

  /**
   * 清空动态文档目录中的所有文档
   * @param directoryId 目录ID（可选，如果不指定则清空所有动态文档）
   */
  clearDynamicDocuments(directoryId?: string): void {
    if (directoryId) {
      // 清空指定目录
      const docs = this.dynamicDocuments.get(directoryId);
      if (docs) {
        // 关闭所有已打开的文档
        docs.forEach((_, docId) => {
          const path = `${directoryId}/${docId}`;
          this.closeFile(path);
        });
        docs.clear();
      }
    } else {
      // 清空所有动态文档
      this.dynamicDocuments.forEach((docs, dirId) => {
        docs.forEach((_, docId) => {
          const path = `${dirId}/${docId}`;
          this.closeFile(path);
        });
        docs.clear();
      });
    }
  }

  /**
   * 打开动态文档（简化方法）
   * @param doc 动态文档
   */
  async openDynamicDocument(doc: DynamicDocument): Promise<void> {
    // 添加到动态文档存储
    this.addDynamicDocument(doc);
    
    // 打开文档
    const directoryId = doc.directoryId || this.DEFAULT_DYNAMIC_DIR_ID;
    const path = `${directoryId}/${doc.id}`;
    await this.openFile(path);
  }

  /**
   * 打开文件（标记文件为已打开）
   * @param path 文件路径，如 "dsl/page1.json"
   */
  async openFile(path: string): Promise<void> {
    const node = await this.root.findByPath(path);
    
    if (!node) {
      return console.warn('[知识库] 文件不存在:', path);
    }

    if (!node.isFile) {
      return console.warn('[知识库] 路径不是文件:', path);
    }

    this.openedFilePaths.add(path);
  }

  /**
   * 关闭文件
   * @param path 文件路径
   */
  closeFile(path: string): void {
    this.openedFilePaths.delete(path);
  }

  /**
   * 检查文件是否已打开
   * @param path 文件路径
   */
  isFileOpened(path: string): boolean {
    return this.openedFilePaths.has(path);
  }

  /**
   * 获取目录树结构（文本格式）
   * 每次调用都会动态获取最新的文件树
   */
  async getDirectoryTree(options?: { 
    maxDepth?: number;
    showDescription?: boolean;
  }): Promise<string> {
    const { maxDepth = Infinity, showDescription = false } = options || {};
    return await this._buildTreeText(this.root, 0, maxDepth, showDescription);
  }

  /**
   * 导出知识库内容（用于发送给大模型）
   * 每次导出都会动态重新获取文件树和文件内容
   */
  async export(options?: ExportOptions): Promise<string> {
    const { includeTree = true } = options || {};

    let result = `# ${this.name}\n`;
    
    if (this.description) {
      result += `${this.description}\n\n`;
    }

    // 导出目录结构树（动态获取）
    if (includeTree) {
      result += `## 目录结构\n`;
      result += await this.getDirectoryTree({ showDescription: true });
      result += '\n\n';
    }

    // 导出已打开的文件内容（每次都重新读取）
    
    if (this.openedFilePaths.size > 0) {
      result += `## 已打开的文件\n\n`;

      result += `注意：以下知识是按照文件打开的知识内容，--BEGIN-- 和 --END-- 是文件分割符，之间的内容是文件内容。\n\n`
      
      // 测试：使用 Array.from 转换后遍历
      const pathsArray = Array.from(this.openedFilePaths);
      
      let iterationCount = 0;
      for (const path of pathsArray) {
        iterationCount++;
        // 动态查找文件节点
        const node = await this.root.findByPath(path);
        
        if (node && node.isFile) {
          try {
            console.log('[KnowledgeBase.export] 开始读取文件内容...');
            const content = await node.getContent();
            
            // 使用 name 作为展示标题（如果是动态文档，name 就是 title）
            const displayTitle = node.name + (node.extname || '');
            result += `### ${displayTitle}\n`;
            
            if (node.description) {
              result += `> ${node.description}\n\n`;
            }
            result += '--BEGIN--\n';
            result += content;
            result += '\n--END--\n\n';
          } catch (error) {
            console.error(`Failed to export file ${path}:`, error);
            const displayTitle = node.name + (node.extname || '');
            result += `### ${displayTitle} [已删除]\n`;
            result += `> 读取失败: ${error}\n\n`;
          }
        } else {
          // 文件不存在或被删除
          result += `### ${path} [已删除]\n`;
          result += `> 该文件已被删除或不存在\n\n`;
        }
      }
    } else {
      result += `## 已打开的文件\n暂无打开的文件\n\n`;
    }

    return result;
  }

  /**
   * 获取根节点
   */
  getRoot(): KnowledgeNode {
    return this.root;
  }

  /**
   * 根据路径查找节点（动态查找）
   */
  async findNode(path: string): Promise<KnowledgeNode | null> {
    return await this.root.findByPath(path);
  }

  /**
   * 清空所有已打开的文件
   */
  clearOpenedFiles(): void {
    this.openedFilePaths.clear();
  }

  /**
   * 获取已打开的文件路径列表
   */
  getOpenedFilePaths(): string[] {
    return Array.from(this.openedFilePaths);
  }

  /**
   * 构建树形文本（动态获取子节点）
   */
  private async _buildTreeText(
    node: KnowledgeNode,
    depth: number,
    maxDepth: number,
    showDescription: boolean,
    currentPath: string = ''
  ): Promise<string> {
    if (depth > maxDepth) {
      return '';
    }

    const prefix = depth > 0 ? '-'.repeat(depth) + ' ' : '';
    let text = '';

    // 根节点不显示
    if (depth > 0) {
      // 隐藏的节点不显示
      if (node.hidden) {
        return '';
      }

      const path = currentPath;
      const openedMark = this.openedFilePaths.has(path) ? ' [已打开]' : '';
      // 直接使用 name 作为展示名称
      const displayName = node.extname ? `${node.name}${node.extname}` : node.name;
      const folderMark = node.isDirectory ? '/' : '';
      const ellipsisMark = node.ellipsis ? ' ...' : '';
      text += `${prefix}${displayName}${folderMark}${openedMark}${ellipsisMark}`;
      
      if (showDescription && node.description && node.description !== 'undefined') {
        text += ` （${node.description}）`;
      }
      
      text += '\n';
    }

    // 动态获取子节点
    if (node.isDirectory) {
      try {
        const children = await node.getChildren();
        for (const child of children) {
          // 直接使用 id 构建路径
          const childId = child.extname ? `${child.id}${child.extname}` : child.id;
          const childPath = currentPath ? `${currentPath}/${childId}` : childId;
          text += await this._buildTreeText(child, depth + 1, maxDepth, showDescription, childPath);
        }
      } catch (error) {
        console.error(`Failed to load children of ${node.name}:`, error);
      }
    }

    return text;
  }
}

