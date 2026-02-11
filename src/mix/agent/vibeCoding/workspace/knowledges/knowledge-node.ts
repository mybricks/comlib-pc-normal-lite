/**
 * 知识节点实现
 */

import { IKnowledgeNode, KnowledgeNodeType, IDirectoryProvider, IFileInfo } from './types';

/**
 * Provider 管理器接口
 */
export interface IProviderManager {
  getProvider(providerId: string): IDirectoryProvider | undefined;
}

/**
 * 知识节点类
 */
export class KnowledgeNode implements IKnowledgeNode {
  id: string;
  name: string;
  type: KnowledgeNodeType;
  description?: string;
  extname?: string;
  ellipsis?: boolean;
  hidden?: boolean;
  children?: KnowledgeNode[];
  metadata?: Record<string, any>;

  private providerManager: IProviderManager;

  constructor(
    id: string,
    name: string,
    type: KnowledgeNodeType,
    providerManager: IProviderManager,
    options?: {
      description?: string;
      extname?: string;
      ellipsis?: boolean;
      hidden?: boolean;
      metadata?: Record<string, any>;
      children?: KnowledgeNode[];
    }
  ) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.providerManager = providerManager;
    this.description = options?.description;
    this.extname = options?.extname;
    this.ellipsis = options?.ellipsis;
    this.hidden = options?.hidden;
    this.metadata = options?.metadata;
    this.children = options?.children;
  }

  /**
   * 是否为目录
   */
  get isDirectory(): boolean {
    return this.type === KnowledgeNodeType.DIRECTORY;
  }

  /**
   * 是否为文件
   */
  get isFile(): boolean {
    return this.type === KnowledgeNodeType.FILE;
  }

  /**
   * 获取文件内容（每次都重新读取）
   */
  async getContent(): Promise<string> {
    if (!this.isFile) {
      throw new Error('Cannot get content from a directory node');
    }

    const providerId = this.metadata?.providerId;
    
    if (!providerId) {
      throw new Error(`No provider found for file ${this.id}`);
    }

    const provider = this.providerManager.getProvider(providerId);
    
    if (!provider) {
      throw new Error(`Provider ${providerId} not registered`);
    }

    try {
      // 构建相对于 provider 的文件 ID（包含扩展名）
      const fileId = this.id;
      
      // 构建完整路径（从根目录开始的完整路径）
      const parentPath = this.metadata?.parentPath;
      const fullPath = parentPath ? `${parentPath}/${fileId}` : fileId;
      
      // 构建文件信息对象
      const fileInfo: IFileInfo = {
        id: this.id, // 相对于 provider 的 ID（包含扩展名，如 "style.less"）
        name: this.name, // 文件名（不含扩展名，如 "style"）
        path: fullPath, // 完整路径（如 "component-code/style.less"）
        extname: this.extname,
        description: this.description,
        metadata: this.metadata
      };
      
      const content = await provider.readFile(fileInfo);
      return content;
    } catch (error) {
      console.error(`Failed to load file ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * 获取目录的子节点列表（每次都动态重新查询）
   */
  async getChildren(): Promise<KnowledgeNode[]> {
    if (!this.isDirectory) {
      throw new Error('Cannot get children from a file node');
    }

    const providerId = this.metadata?.providerId;
    if (!providerId) {
      throw new Error(`No provider found for directory ${this.id}`);
    }

    const provider = this.providerManager.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not registered`);
    }

    try {
      const nodes = await provider.getChildren(this.id);
      return nodes.map(node => 
        new KnowledgeNode(
          node.id, 
          node.name, 
          node.type,
          this.providerManager,
          {
            description: node.description,
            extname: node.extname,
            ellipsis: node.ellipsis,
            hidden: node.hidden,
            // 传递父路径到子节点，用于 readFile 时拼接完整路径
            metadata: { 
              providerId, 
              parentPath: this.id === '__root__' ? '' : this.id,  // 根节点的 parentPath 为空
              ...node.metadata 
            },
            children: node.children as KnowledgeNode[]
          }
        )
      );
    } catch (error) {
      console.error(`Failed to load directory ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * 添加子节点
   */
  addChild(child: KnowledgeNode): void {
    if (!this.isDirectory) {
      throw new Error('Cannot add child to a file node');
    }

    if (!this.children) {
      this.children = [];
    }

    this.children.push(child);
  }

  /**
   * 根据路径查找节点（动态获取子节点）
   * @param path 路径，如 "dsl/page1"
   */
  async findByPath(path: string): Promise<KnowledgeNode | null> {
    const parts = path.split('/').filter(Boolean);
    return await this._findByParts(parts);
  }

  private async _findByParts(parts: string[]): Promise<KnowledgeNode | null> {
    
    if (parts.length === 0) {
      return this;
    }

    const [first, ...rest] = parts;

    if (!this.isDirectory) {
      return null;
    }

    // 动态获取子节点
    const children = await this.getChildren();
    
    // 直接使用 id 匹配路径段
    const child = children.find(c => {
      const fullId = c.extname ? `${c.id}${c.extname}` : c.id;
      return fullId === first || c.id === first;
    });
    
    if (!child) {
      return null;
    }

    if (rest.length === 0) {
      return child;
    }

    return await child._findByParts(rest);
  }

  /**
   * 获取节点的完整路径（动态获取子节点）
   */
  async getPath(root: KnowledgeNode): Promise<string> {
    const path = await this._buildPath(root);
    return path.join('/');
  }

  private async _buildPath(root: KnowledgeNode, currentPath: string[] = []): Promise<string[]> {
    if (root === this) {
      return currentPath;
    }

    if (!root.isDirectory) {
      return [];
    }

    // 动态获取子节点
    const children = await root.getChildren();
    
    for (const child of children) {
      const path = await this._buildPath(child, [...currentPath, child.name]);
      if (path.length > 0) {
        return path;
      }
    }

    return [];
  }

  /**
   * 转换为普通对象
   */
  toJSON(): IKnowledgeNode {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      description: this.description,
      extname: this.extname,
      ellipsis: this.ellipsis,
      hidden: this.hidden,
      metadata: this.metadata,
      children: this.children?.map(c => c.toJSON())
    };
  }
}

