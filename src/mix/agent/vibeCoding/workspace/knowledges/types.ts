/**
 * 知识库类型定义
 */

/**
 * 知识节点类型
 */
export enum KnowledgeNodeType {
  /** 目录 */
  DIRECTORY = 'directory',
  /** 文件 */
  FILE = 'file'
}

/**
 * 知识节点接口
 */
export interface IKnowledgeNode {
  /** 节点ID */
  id: string;
  /** 节点名称 */
  name: string;
  /** 节点类型 */
  type: KnowledgeNodeType;
  /** 节点描述 */
  description?: string;
  /** 文件扩展名（如 .dsl, .md 等；目录也可以有扩展名） */
  extname?: string;
  /** 是否显示省略号（表示不完整的树） */
  ellipsis?: boolean;
  /** 是否隐藏（隐藏的节点不在目录树中显示，但可以打开） */
  hidden?: boolean;
  /** 子节点（仅目录类型） */
  children?: IKnowledgeNode[];
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 文件信息接口
 * 用于 readFile 函数，提供文件的完整信息
 */
export interface IFileInfo {
  /** 文件ID（相对于 provider 的路径，如 "style.less" 或 "subdir/file.js"） */
  id: string;
  /** 文件名（不含扩展名，如 "style"） */
  name: string;
  /** 完整路径（从根目录开始的完整路径，如 "component-code/style.less"） */
  path: string;
  /** 文件扩展名（如 ".less", ".jsx"） */
  extname?: string;
  /** 文件描述 */
  description?: string;
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 目录提供者接口
 * 定义目录提供者需要实现的方法
 */
export interface IDirectoryProvider {
  /** 目录ID */
  readonly id: string;
  /** 目录名称 */
  readonly name: string;
  /** 目录描述 */
  readonly description?: string;
  /** 权重（数字越大优先级越高，影响目录顺序和打开文件的顺序），默认为 0 */
  readonly weight?: number;

  /**
   * 获取根目录节点信息
   */
  getRootNode(): IKnowledgeNode;

  /**
   * 获取子节点列表（动态获取最新数据）
   * @param parentId 父节点ID
   * @returns 子节点列表
   */
  getChildren(parentId: string): Promise<IKnowledgeNode[]>;

  /**
   * 读取文件内容（动态获取最新内容）
   * @param fileInfo 文件信息对象，包含 id、name、path 等完整信息
   * @returns 文件内容
   */
  readFile(fileInfo: IFileInfo): Promise<string>;
}

/**
 * 目录提供者配置
 */
export interface DirectoryProviderConfig {
  /** 目录ID */
  id: string;
  /** 目录名称 */
  name: string;
  /** 目录描述 */
  description?: string;
  /** 权重（数字越大优先级越高） */
  weight?: number;
  /** 是否隐藏 */
  hidden?: boolean;
  /** 获取子节点的函数 */
  getChildren: (parentId: string) => Promise<IKnowledgeNode[]>;
  /** 读取文件内容的函数 */
  readFile: (fileInfo: IFileInfo) => Promise<string>;
  /** 自定义根节点（可选，如果不提供则使用默认的目录节点） */
  customRootNode?: IKnowledgeNode;
}

/**
 * DirectoryProvider 类
 * 使用 new DirectoryProvider(config) 创建，而不是继承
 */
export class DirectoryProvider implements IDirectoryProvider {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly weight: number;
  readonly hidden: boolean;
  
  private _getChildren: (parentId: string) => Promise<IKnowledgeNode[]>;
  private _readFile: (fileInfo: IFileInfo) => Promise<string>;
  private _customRootNode?: IKnowledgeNode;

  constructor(config: DirectoryProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.weight = config.weight ?? 0;
    this.hidden = config.hidden ?? false;
    this._getChildren = config.getChildren;
    this._readFile = config.readFile;
    this._customRootNode = config.customRootNode;
  }

  /**
   * 获取根目录节点信息
   */
  getRootNode(): IKnowledgeNode {
    if (this._customRootNode) {
      return this._customRootNode;
    }
    return {
      id: this.id,
      name: this.name,
      type: KnowledgeNodeType.DIRECTORY,
      description: this.description,
      hidden: this.hidden,
      metadata: { providerId: this.id }
    };
  }

  /**
   * 获取子节点列表
   */
  async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
    return await this._getChildren(parentId);
  }

  /**
   * 读取文件内容
   */
  async readFile(fileInfo: IFileInfo): Promise<string> {
    return await this._readFile(fileInfo);
  }
}

/**
 * 动态文档接口
 */
export interface DynamicDocument {
  /** 文档唯一ID */
  id: string;
  /** 文档标题 */
  title?: string;
  /** 文档描述 */
  description?: string;
  /** 文档内容 */
  content: string;
  /** 文档类型（如：画布、组件等，用于分类） */
  docType?: string;
  /** 文件扩展名，默认为 .md */
  extname?: string;
  /** 所属目录的ID（如果不指定则使用默认动态文档目录） */
  directoryId?: string;
}

/**
 * 动态文档目录配置
 */
export interface DynamicDocDirectoryConfig {
  /** 目录ID */
  id: string;
  /** 目录名称 */
  name: string;
  /** 目录描述 */
  description?: string;
  /** 权重（数字越大优先级越高） */
  weight?: number;
  /** 是否隐藏（隐藏的目录不在目录树中显示，但可以打开文件） */
  hidden?: boolean;
}

/**
 * 知识库配置
 */
export interface KnowledgeBaseConfig {
  /** 知识库名称 */
  name: string;
  /** 知识库描述 */
  description?: string;
}

/**
 * 知识库导出选项
 */
export interface ExportOptions {
  /** 是否包含目录树 */
  includeTree?: boolean;
  /** 是否包含动态文档 */
  includeDynamicDocs?: boolean;
}

