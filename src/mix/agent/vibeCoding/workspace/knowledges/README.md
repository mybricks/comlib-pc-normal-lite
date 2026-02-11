# Knowledges - 知识库系统

## 概述

知识库系统是一个用于组织和管理发送给大模型的消息内容的抽象框架。它通过虚拟的目录树结构来组织各类知识，并支持完全动态的内容获取，实现了与具体内容（如DSL、组件文档等）的解耦。

**核心特性**：
- 每次 export 时动态获取最新的文件树和文件内容，确保数据实时性
- 只初始化一个根目录，所有内容完全动态获取
- 通过 `new DirectoryProvider(config)` 创建 Provider，代码组织清晰
- 支持动态文档功能，可以运行时添加/删除文档
- 支持多个动态文档目录，每个目录独立配置
- 支持权重排序，控制目录和文件的显示顺序
- 支持隐藏节点，隐藏的节点不在目录树中显示但可以打开
- 自动标记已删除的文件

## 核心概念

### 1. 知识库 (KnowledgeBase)

知识库是整个系统的核心，管理着目录提供者（Provider）、动态文档和已打开的文件。一个知识库本质上对应着一条发送给大模型的消息。

**主要功能**：
- 注册和管理 Provider
- 注册和管理动态文档目录
- 添加/删除/打开动态文档
- 打开/关闭文件
- 导出知识库内容

### 2. 知识节点 (KnowledgeNode)

知识节点是知识库中的基本单元，可以是：
- **目录节点**：组织结构，包含子节点
- **文件节点**：实际的知识内容

**节点属性**：
- `id` - 节点唯一标识
- `name` - 节点名称（用于展示）
- `type` - 节点类型（DIRECTORY 或 FILE）
- `description` - 节点描述
- `extname` - 文件扩展名（如 `.md`, `.json` 等）
- `hidden` - 是否隐藏（隐藏的节点不在目录树中显示）
- `ellipsis` - 是否显示省略号（表示不完整的树）
- `metadata` - 元数据

### 3. 目录提供者 (DirectoryProvider)

每种目录类型（如项目信息、组件文档等）通过 `new DirectoryProvider(config)` 创建，负责：
- 定义目录的基本信息（id、name、description、weight）
- 动态获取子节点列表（getChildren）
- 动态读取文件内容（readFile）
- 可以自定义根节点（customRootNode），将目录呈现为文件

### 4. 动态文档 (DynamicDocument)

动态文档是运行时动态添加的文档，可以聚合在不同的动态文档目录下：
- 支持添加/删除动态文档
- 支持注册多个动态文档目录
- 每个目录可以独立配置名称、描述、权重、是否隐藏
- 动态文档可以像普通文件一样打开和导出

## 使用示例

### 基础使用

```typescript
import { 
  KnowledgeBase,
  DirectoryProvider,
  IKnowledgeNode,
  KnowledgeNodeType
} from './knowledges';

// 1. 创建知识库
const knowledgeBase = new KnowledgeBase({
  name: 'Workspace Knowledge',
  description: '工作空间知识库，包含项目的所有相关信息'
});

// 2. 创建并注册 Provider（使用 new DirectoryProvider）
const projectInfoProvider = new DirectoryProvider({
  id: 'project-info',
  name: '项目信息',
  description: '包含项目的基本信息',
  weight: 100, // 权重越大越靠前
  
  async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
    if (parentId === 'project-info') {
      const pages = await fetchAllPages();
      return pages.map(page => ({
        id: page.id,
        name: page.name,
        type: KnowledgeNodeType.FILE,
        extname: '.dsl',
        description: page.description,
        metadata: { providerId: 'project-info', pageId: page.id }
      }));
    }
    return [];
  },
  
  async readFile(fileId: string): Promise<string> {
    return await fetchPageContent(fileId);
  }
});

knowledgeBase.registerProvider(projectInfoProvider);

// 3. 创建并注册另一个 Provider
const docsProvider = new DirectoryProvider({
  id: 'component-docs',
  name: '组件文档',
  description: '组件配置文档',
  weight: 80,
  hidden: true, // 隐藏目录，不在目录树中显示
  
  async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
    if (parentId === 'component-docs') {
      const components = await fetchAllComponents();
      return components.map(comp => ({
        id: comp.namespace,
        name: comp.abbreviation,
        type: KnowledgeNodeType.FILE,
        extname: '.md',
        hidden: true, // 文件也是隐藏的
        metadata: { providerId: 'component-docs', namespace: comp.namespace }
      }));
    }
    return [];
  },
  
  async readFile(fileId: string): Promise<string> {
    return await fetchComponentDoc(fileId);
  }
});

knowledgeBase.registerProvider(docsProvider);

// 4. 标记要打开的文件
await knowledgeBase.openFile('project-info/首页.dsl');
await knowledgeBase.openFile('component-docs/pc.button.md'); // 可以打开隐藏文件

// 5. 导出（动态获取最新文件树和内容）
const message = await knowledgeBase.export({
  includeTree: true
});

console.log(message);
// 输出：
// # Workspace Knowledge
// 工作空间知识库，包含项目的所有相关信息
//
// ## 目录结构
// - 项目信息/ （包含项目的基本信息）
//   - 首页.dsl [已打开]
//   - 详情页.dsl
// （组件文档目录被隐藏，不显示在目录树中）
//
// ## 已打开的文件
//
// ### 首页.dsl
// > 首页描述
// --BEGIN--
// { ... DSL 内容 ... }
// --END--
//
// ### pc.button.md
// > 按钮组件
// --BEGIN--
// # Button 组件文档
// ...
// --END--
```

### 创建自定义 Provider - 基础示例

```typescript
import { DirectoryProvider, IKnowledgeNode, KnowledgeNodeType } from './knowledges';

// 方式1：使用 new DirectoryProvider 创建（推荐）
function createFocusInfoProvider(getFocusInfo: () => Promise<string>) {
  return new DirectoryProvider({
    id: 'focus-info',
    name: '聚焦信息',
    description: '当前聚焦的信息',
    weight: 90,
    
    async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
      if (parentId === 'focus-info') {
        return [{
          id: 'focus-description',
          name: 'description',
          type: KnowledgeNodeType.FILE,
          extname: '.md',
          description: '当前聚焦的信息',
          metadata: { providerId: 'focus-info' }
        }];
      }
      return [];
    },
    
    async readFile(fileId: string): Promise<string> {
      if (fileId === 'focus-info/focus-description') {
        return await getFocusInfo();
      }
      throw new Error(`File not found: ${fileId}`);
    }
  });
}

// 使用
const focusProvider = createFocusInfoProvider(
  async () => '当前聚焦的页面是：首页'
);
knowledgeBase.registerProvider(focusProvider);
```

### 将目录呈现为文件

有时你希望将一个 Provider 呈现为单个文件而不是目录，可以使用 `customRootNode`：

```typescript
// 创建一个作为文件呈现的 Provider
const projectInfoProvider = new DirectoryProvider({
  id: 'project-info',
  name: '项目信息',
  description: '包含项目的画布索引',
  weight: 100,
  
  // 自定义根节点为文件
  customRootNode: {
    id: 'project-info',
    name: '项目信息',
    type: KnowledgeNodeType.FILE,
    extname: '.md',
    description: '包含项目的画布索引',
    metadata: { providerId: 'project-info' }
  },
  
  // 因为是文件，所以没有子节点
  async getChildren(parentId: string) {
    return [];
  },
  
  // 读取文件内容
  async readFile(fileId: string) {
    if (fileId !== 'project-info') {
      throw new Error(`Invalid file ID: ${fileId}`);
    }
    return await generateProjectInfo();
  }
});

knowledgeBase.registerProvider(projectInfoProvider);

// 现在可以直接打开这个文件
await knowledgeBase.openFile('项目信息.md');
```

### 动态文档功能

动态文档是运行时动态添加的文档，非常适合用于临时内容或用户操作生成的内容：

```typescript
// 1. 注册动态文档目录
knowledgeBase.registerDynamicDirectory({
  id: 'opened-pages',
  name: '已打开的页面',
  description: '用户打开的页面文档',
  weight: 80,
  hidden: false // 不隐藏，在目录树中显示
});

// 2. 添加动态文档到指定目录
knowledgeBase.addDynamicDocument({
  id: 'page1',
  title: '首页',
  description: '项目首页',
  content: '<页面内容>',
  directoryId: 'opened-pages',
  extname: '.md'
});

// 3. 打开动态文档（简化方法）
await knowledgeBase.openDynamicDocument({
  id: 'page2',
  title: '详情页',
  content: '<详情页内容>',
  directoryId: 'opened-pages'
});

// 4. 获取动态文档
const doc = knowledgeBase.getDynamicDocument('page1', 'opened-pages');

// 5. 删除动态文档
knowledgeBase.removeDynamicDocument('page1', 'opened-pages');

// 6. 清空目录中的所有动态文档
knowledgeBase.clearDynamicDocuments('opened-pages');

// 目录树中会显示：
// - 已打开的页面/ （用户打开的页面文档）
//   - 首页.md [已打开]
//   - 详情页.md [已打开]
```

### 处理已删除的文件

当一个已打开的文件被删除后，export 时会自动标记为"已删除"：

```typescript
// 打开一个文件
await knowledgeBase.openFile('project-info/temp.dsl');

// 稍后该文件被删除...

// 导出时会自动处理
const message = await knowledgeBase.export();
// 输出：
// ### temp.dsl [已删除]
// > 该文件已被删除或不存在
```

## API 文档

### KnowledgeBase

#### 构造函数
```typescript
constructor(config: KnowledgeBaseConfig)

interface KnowledgeBaseConfig {
  name: string;
  description?: string;
}
```

#### Provider 管理

- `registerProvider(provider: IDirectoryProvider): void` - 注册目录提供者
- `getProvider(providerId: string): IDirectoryProvider | undefined` - 获取 Provider

#### 动态文档管理

- `registerDynamicDirectory(config: DynamicDocDirectoryConfig): void` - 注册动态文档目录
- `addDynamicDocument(doc: DynamicDocument): void` - 添加动态文档
- `removeDynamicDocument(docId: string, directoryId?: string): void` - 删除动态文档
- `getDynamicDocument(docId: string, directoryId?: string): DynamicDocument | undefined` - 获取动态文档
- `clearDynamicDocuments(directoryId?: string): void` - 清空动态文档
- `openDynamicDocument(doc: DynamicDocument): Promise<void>` - 打开动态文档（简化方法）

#### 文件管理

- `openFile(path: string): Promise<void>` - 打开文件（动态查找文件）
- `closeFile(path: string): void` - 关闭文件
- `isFileOpened(path: string): boolean` - 检查文件是否已打开
- `getOpenedFilePaths(): string[]` - 获取所有已打开的文件路径
- `clearOpenedFiles(): void` - 清空所有已打开的文件

#### 查询和导出

- `getRoot(): KnowledgeNode` - 获取根节点
- `findNode(path: string): Promise<KnowledgeNode | null>` - 根据路径查找节点（动态查找）
- `getDirectoryTree(options?): Promise<string>` - 获取目录树文本（动态获取，隐藏节点不显示）
- `export(options?: ExportOptions): Promise<string>` - 导出为消息内容（动态获取，自动标记已删除文件）

### DirectoryProvider

通过 `new DirectoryProvider(config)` 创建：

#### DirectoryProviderConfig

```typescript
interface DirectoryProviderConfig {
  // 基本信息
  id: string;                // Provider 唯一标识
  name: string;              // 目录名称
  description?: string;      // 目录描述
  weight?: number;           // 权重（数字越大优先级越高），默认为 0
  hidden?: boolean;          // 是否隐藏（隐藏的目录不在目录树中显示）
  
  // 自定义根节点（可选）
  customRootNode?: IKnowledgeNode;
  
  // 必须实现的方法
  getChildren: (parentId: string) => Promise<IKnowledgeNode[]>;
  readFile: (fileId: string) => Promise<string>;
}
```

#### DynamicDocument

```typescript
interface DynamicDocument {
  id: string;              // 文档唯一ID
  title?: string;          // 文档标题
  description?: string;    // 文档描述
  content: string;         // 文档内容
  docType?: string;        // 文档类型（用于分类）
  extname?: string;        // 文件扩展名，默认 .md
  directoryId?: string;    // 所属目录ID
}
```

#### DynamicDocDirectoryConfig

```typescript
interface DynamicDocDirectoryConfig {
  id: string;              // 目录ID
  name: string;            // 目录名称
  description?: string;    // 目录描述
  weight?: number;         // 权重（数字越大优先级越高）
  hidden?: boolean;        // 是否隐藏
}
```

### KnowledgeNode

#### 属性

- `id: string` - 节点ID
- `name: string` - 节点名称
- `type: KnowledgeNodeType` - 节点类型
- `description?: string` - 节点描述
- `extname?: string` - 文件扩展名（如 .dsl, .md 等；目录也可以有扩展名）
- `ellipsis?: boolean` - 是否显示省略号（表示不完整的树）
- `hidden?: boolean` - 是否隐藏（隐藏的节点不在目录树中显示，但可以打开）
- `children?: KnowledgeNode[]` - 子节点（仅目录类型）
- `metadata?: Record<string, any>` - 元数据

#### 主要方法

- `getContent(): Promise<string>` - 获取文件内容（每次都重新读取）
- `getChildren(): Promise<KnowledgeNode[]>` - 获取目录的子节点列表（每次都动态重新查询）
- `findByPath(path: string): Promise<KnowledgeNode | null>` - 根据路径查找节点（动态查找）
- `getPath(root: KnowledgeNode): Promise<string>` - 获取节点路径（动态获取）

## 设计原则

1. **解耦**: 知识库与具体内容（DSL、组件文档等）解耦，通过 `new DirectoryProvider(config)` 创建 Provider
2. **完全动态**: 每次 export 都动态获取最新的文件树和文件内容，确保数据实时性
3. **轻量级**: 只初始化一个根目录，不缓存任何文件结构和内容
4. **容错性**: 自动标记已删除的文件，不影响整体导出
5. **可扩展**: 通过创建新的 Provider 轻松添加新的目录类型
6. **代码组织**: 每种目录类型独立的 Provider，避免回调中的大量 if-else
7. **灵活性**: 支持动态文档、权重排序、隐藏节点等高级功能
8. **类型安全**: 完整的 TypeScript 类型定义

## 与 Workspace 的集成

知识库系统可以与 Workspace 集成，查看 `workspace-by-knowledges` 目录了解完整实现：

```typescript
import { KnowledgeBase, DirectoryProvider, IKnowledgeNode, KnowledgeNodeType } from './knowledges';

// 创建 Provider 工厂函数
function createProjectInfoProvider() {
  return new DirectoryProvider({
    id: 'project-info',
    name: '项目信息',
    description: '包含项目的画布索引',
    weight: 100,
    
    // 将目录呈现为文件
    customRootNode: {
      id: 'project-info',
      name: '项目信息',
      type: KnowledgeNodeType.FILE,
      extname: '.md',
      metadata: { providerId: 'project-info' }
    },
    
    async getChildren(parentId: string) {
      return []; // 文件没有子节点
    },
    
    async readFile(fileId: string) {
      const pages = await fetchAllPages();
      return generateProjectInfo(pages);
    }
  });
}

class Workspace extends KnowledgeBase {
  constructor() {
    super({
      name: 'Workspace',
      description: '工作空间知识库'
    });

    // 注册各种 Provider
    this.registerProvider(createProjectInfoProvider());
    this.registerProvider(createFocusInfoProvider());
    this.registerProvider(createComponentDocsProvider());
    
    // 注册动态文档目录
    this.registerDynamicDirectory({
      id: 'opened-pages',
      name: '已打开的页面',
      weight: 80
    });
    
    // 默认打开项目信息和聚焦信息
    this.openDefaultFiles();
  }

  private async openDefaultFiles() {
    await this.openFile('项目信息.md');
    await this.openFile('聚焦信息.md');
  }

  async openComponentDoc(namespace: string) {
    const abbreviation = getAbbreviation(namespace);
    await this.openFile(`组件配置文档/${abbreviation}.md`);
  }

  async openDocument(id: string, options: { type: string; content: string }) {
    await this.openDynamicDocument({
      id,
      title: id,
      content: options.content,
      directoryId: 'opened-pages'
    });
  }
}

// 使用
const workspace = new Workspace();
await workspace.openComponentDoc('mybricks.normal-pc.button');
await workspace.openDocument('page1', { type: '画布', content: '<页面内容>' });
const message = await workspace.export();
```

## 高级特性

### 权重排序

通过 `weight` 属性控制目录和文件的显示顺序：

```typescript
// 权重越大越靠前
const projectInfoProvider = new DirectoryProvider({
  id: 'project-info',
  weight: 100, // 最高权重，排第一
  // ...
});

const focusInfoProvider = new DirectoryProvider({
  id: 'focus-info',
  weight: 90, // 排第二
  // ...
});

const componentDocsProvider = new DirectoryProvider({
  id: 'component-docs',
  weight: 0, // 默认权重，排最后
  // ...
});
```

### 隐藏节点

通过 `hidden` 属性隐藏节点，隐藏的节点不在目录树中显示但可以打开：

```typescript
const componentDocsProvider = new DirectoryProvider({
  id: 'component-docs',
  hidden: true, // 目录隐藏
  
  async getChildren(parentId: string) {
    return components.map(comp => ({
      id: comp.namespace,
      name: comp.abbreviation,
      type: KnowledgeNodeType.FILE,
      hidden: true, // 文件也隐藏
      // ...
    }));
  },
  // ...
});

// 可以打开隐藏文件
await knowledgeBase.openFile('component-docs/pc.button.md');

// 导出时会包含已打开的隐藏文件
const content = await knowledgeBase.export();
```

### 省略号支持

通过 `ellipsis` 属性标记节点为不完整的树：

```typescript
return [{
  id: 'partial-tree',
  name: '部分树结构',
  type: KnowledgeNodeType.DIRECTORY,
  ellipsis: true, // 标记为不完整
  // ...
}];

// 目录树中会显示：
// - 部分树结构/ ...
```

## 扩展建议

1. 支持文件内容缓存策略，减少重复读取
2. 支持批量打开/关闭文件
3. 添加文件打开历史记录
4. 支持文件变更监听和自动更新
5. 支持文件搜索和过滤功能
6. 支持多层嵌套的目录结构（在 Provider 的 getChildren 中实现）
7. 支持文件分组和标签功能
