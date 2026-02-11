# Knowledges 知识库系统 - 设计总结

## 🎯 设计目标

为大模型消息生成设计一个**解耦的、可扩展的知识库系统**，用于组织和管理发送给AI的结构化信息。

## ✨ 核心特性

### 1. 完全解耦
- ✅ 知识库与具体内容（DSL、组件文档等）**完全分离**
- ✅ 通过 `new DirectoryProvider(config)` **创建 Provider**
- ✅ 易于测试和维护

### 2. 完全动态
- ✅ 每次 export 时**动态获取最新文件树和内容**
- ✅ 只初始化一个根目录，所有内容完全动态
- ✅ 确保数据始终是最新的

### 3. 代码组织清晰
- ✅ 每种目录类型独立的 **Provider**
- ✅ 避免回调中的大量 if-else 判断
- ✅ 支持任意深度的嵌套结构
- ✅ 支持**自定义元数据**和**自定义根节点**

### 4. 灵活性强
- ✅ 支持**动态文档**功能，运行时添加/删除文档
- ✅ 支持**多个动态文档目录**，每个目录独立配置
- ✅ 支持**权重排序**，控制目录和文件的显示顺序
- ✅ 支持**隐藏节点**，隐藏的节点不在目录树中显示但可以打开

### 5. 容错性强
- ✅ 自动标记已删除的文件
- ✅ 不依赖真实文件系统
- ✅ 支持动态生成目录结构

## 📂 项目结构

```
knowledges/
├── 核心文件
│   ├── index.ts                 # 主导出
│   ├── types.ts                 # 类型定义
│   ├── knowledge-base.ts        # 知识库管理器 (核心)
│   └── knowledge-node.ts        # 知识节点 (基础单元)
│
└── 文档
    ├── README.md                # 完整文档
    └── SUMMARY.md               # 本文件
```

## 🔑 核心概念

### 知识库消息的组成

```
┌─────────────────────────────────────┐
│         知识库消息 (Message)          │
├─────────────────────────────────────┤
│                                     │
│  1. 目录结构树 (Directory Tree)      │
│     └─ 展示知识的组织结构             │
│                                     │
│  2. 已打开的文件 (Opened Files)      │
│     └─ 实际的知识内容                │
│                                     │
└─────────────────────────────────────┘
```

### 两层架构

```
┌──────────────────────────────────────┐
│     应用层 (Application Layer)        │
│  Workspace / 用户代码                 │
│  实现各种 DirectoryProvider           │
│  (DSLProvider, DocsProvider, etc.)   │
└────────────┬─────────────────────────┘
             │
             │ 注册 Provider（动态获取）
             ▼
┌──────────────────────────────────────┐
│     抽象层 (Abstract Layer)           │
│  KnowledgeBase + KnowledgeNode       │
│  (与具体业务完全解耦)                  │
│  每次 export 动态调用 Provider 获取最新数据   │
└──────────────────────────────────────┘
```

## 🏗️ 设计模式

| 模式 | 应用 | 好处 |
|------|------|------|
| **策略模式** | DirectoryProvider | 每种目录类型独立策略 |
| **注册模式** | registerProvider | 灵活注册不同的 Provider |
| **组合模式** | KnowledgeNode树结构 | 统一处理目录和文件 |
| **工厂模式** | `new DirectoryProvider(config)` | 通过配置创建 Provider |
| **动态获取** | export时调用Provider | 确保数据实时性 |
| **容错处理** | 已删除文件标记 | 提高系统健壮性 |

## 💡 使用流程

### 完整流程图

```
创建知识库
    ↓
创建并注册 Provider
    ↓
标记要打开的文件
    ↓
导出为消息（动态获取最新文件树和内容）
    ↓
发送给大模型
```

### 代码示例

```typescript
import { KnowledgeBase, DirectoryProvider, IKnowledgeNode, KnowledgeNodeType } from './knowledges';

// 1. 创建知识库
const kb = new KnowledgeBase({
  name: 'Workspace',
  description: '工作空间知识库'
});

// 2. 使用 new DirectoryProvider 创建并注册 Provider（推荐方式）
const projectInfoProvider = new DirectoryProvider({
  id: 'project-info',
  name: '项目信息',
  description: 'DSL 页面定义',
  weight: 100, // 高权重，排在最前面
  
  async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
    if (parentId === 'project-info') {
      const pages = await fetchAllPages(); // 动态获取最新页面列表
      return pages.map(p => ({
        id: p.id,
        name: p.name,
        type: KnowledgeNodeType.FILE,
        extname: '.dsl',
        metadata: { providerId: 'project-info', pageId: p.id }
      }));
    }
    return [];
  },
  
  async readFile(fileId: string): Promise<string> {
    return await fetchPageContent(fileId);
  }
});

kb.registerProvider(projectInfoProvider);

// 3. 注册组件文档 Provider（隐藏目录）
const componentDocsProvider = new DirectoryProvider({
  id: 'component-docs',
  name: '组件配置文档',
  description: '所有组件的详细配置文档',
  weight: 0,
  hidden: true, // 隐藏，不在目录树中显示
  
  async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
    if (parentId === 'component-docs') {
      const components = await fetchAllComponents();
      return components.map(comp => ({
        id: comp.namespace,
        name: comp.abbreviation,
        type: KnowledgeNodeType.FILE,
        extname: '.md',
        hidden: true, // 文件也隐藏
        metadata: { providerId: 'component-docs', namespace: comp.namespace }
      }));
    }
    return [];
  },
  
  async readFile(fileId: string): Promise<string> {
    return await fetchComponentDoc(fileId);
  }
});

kb.registerProvider(componentDocsProvider);

// 4. 注册动态文档目录
kb.registerDynamicDirectory({
  id: 'opened-pages',
  name: '已打开的页面',
  description: '用户打开的页面文档',
  weight: 80
});

// 5. 标记要打开的文件
await kb.openFile('project-info/page1.dsl');
await kb.openFile('component-docs/pc.button.md'); // 可以打开隐藏文件

// 6. 添加动态文档
await kb.openDynamicDocument({
  id: 'page1_u_123',
  title: '首页',
  content: '<页面内容>',
  directoryId: 'opened-pages'
});

// 7. 导出（动态获取最新数据）
const message = await kb.export();
// 发送给大模型
```

## 🔌 扩展点

### 1. 创建简单的自定义 Provider

```typescript
import { DirectoryProvider, IKnowledgeNode, KnowledgeNodeType } from './knowledges';

// 创建一个聚焦信息 Provider（使用 new DirectoryProvider）
function createFocusInfoProvider(getFocusInfo: () => Promise<string>) {
  return new DirectoryProvider({
    id: 'focus-info',
    name: '聚焦信息',
    description: '当前聚焦的信息',
    weight: 90,
    
    // 将目录呈现为文件
    customRootNode: {
      id: 'focus-info',
      name: '聚焦信息',
      type: KnowledgeNodeType.FILE,
      extname: '.md',
      metadata: { providerId: 'focus-info' }
    },
    
    async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
      return []; // 文件没有子节点
    },
    
    async readFile(fileId: string): Promise<string> {
      if (fileId === 'focus-info') {
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

// 可以直接打开
await knowledgeBase.openFile('聚焦信息.md');
```

### 2. 创建多层嵌套的 Provider

```typescript
const assetsProvider = new DirectoryProvider({
  id: 'assets',
  name: '资源文件',
  description: '项目资源文件',
  
  async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
    if (parentId === 'assets') {
      // 第一层：返回子目录
      return [
        { 
          id: 'assets/image', 
          name: 'image', 
          type: KnowledgeNodeType.DIRECTORY,
          metadata: { providerId: 'assets', type: 'image-dir' }
        },
        { 
          id: 'assets/style', 
          name: 'style', 
          type: KnowledgeNodeType.DIRECTORY,
          metadata: { providerId: 'assets', type: 'style-dir' }
        }
      ];
    }
    
    if (parentId === 'assets/image') {
      // 第二层：返回图片文件
      const images = await fetchAllImages();
      return images.map(img => ({
        id: `assets/image/${img.id}`,
        name: img.name,
        type: KnowledgeNodeType.FILE,
        metadata: { providerId: 'assets', assetId: img.id }
      }));
    }
    
    return [];
  },
  
  async readFile(fileId: string): Promise<string> {
    // 读取文件内容...
    const match = fileId.match(/^assets\/image\/(.+)$/);
    if (match) {
      return await fetchImageInfo(match[1]);
    }
    throw new Error(`File not found: ${fileId}`);
  }
});
```

### 3. Provider 中实现缓存和错误处理

```typescript
// 使用闭包实现缓存
function createCachedDSLProvider() {
  const cache = new Map<string, string>();
  
  return new DirectoryProvider({
    id: 'dsl',
    name: 'DSL 页面定义',
    description: 'DSL 页面定义（带缓存）',
    
    async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
      if (parentId === 'dsl') {
        const pages = await fetchAllPages();
        return pages.map(p => ({
          id: p.id,
          name: p.name,
          type: KnowledgeNodeType.FILE,
          extname: '.dsl',
          metadata: { providerId: 'dsl', pageId: p.id }
        }));
      }
      return [];
    },
    
    async readFile(fileId: string): Promise<string> {
      // 从缓存读取
      if (cache.has(fileId)) {
        console.log('Cache hit:', fileId);
        return cache.get(fileId)!;
      }
      
      try {
        // 异步获取
        const content = await fetchContent(fileId);
        
        // 写入缓存
        cache.set(fileId, content);
        
        return content;
      } catch (error) {
        console.error('Error loading file:', error);
        return '// Error loading file';
      }
    }
  });
}

// 如需清除缓存，可以导出清除函数
const { provider, clearCache } = (() => {
  const cache = new Map<string, string>();
  
  return {
    provider: new DirectoryProvider({
      id: 'dsl',
      name: 'DSL 页面定义',
      // ... 使用 cache
      async readFile(fileId: string) {
        if (cache.has(fileId)) return cache.get(fileId)!;
        const content = await fetchContent(fileId);
        cache.set(fileId, content);
        return content;
      }
    } as any),
    clearCache: () => cache.clear()
  };
})();
```

## 🚀 快速开始

### 5分钟上手

```typescript
import { KnowledgeBase, DirectoryProvider, IKnowledgeNode, KnowledgeNodeType } from './knowledges';

// 1. 创建自定义 Provider
class DSLProvider extends DirectoryProvider {
  readonly id = 'dsl';
  readonly name = 'dsl';
  readonly description = 'DSL 页面定义';

  constructor(
    private getPages: () => Promise<PageInfo[]>,
    private getContent: (pageId: string) => Promise<string>
  ) {
    super();
  }

  async getChildren(parentId: string): Promise<IKnowledgeNode[]> {
    if (parentId === this.id) {
      const pages = await this.getPages();
      return pages.map(p => ({
        id: `dsl-page-${p.id}`,
        name: p.name,
        type: KnowledgeNodeType.FILE,
        extname: '.dsl',
        metadata: { providerId: this.id, pageId: p.id }
      }));
    }
    return [];
  }

  async readFile(fileId: string): Promise<string> {
    const pageId = fileId.replace('dsl-page-', '');
    return await this.getContent(pageId);
  }
}

// 2. 创建知识库
const kb = new KnowledgeBase({ 
  name: 'My KB',
  description: '我的知识库'
});

// 3. 注册 Provider
kb.registerProvider(new DSLProvider(
  async () => await fetchAllPages(),
  async (pageId) => await fetchPageContent(pageId)
));

// 4. 使用
await kb.openFile('dsl/page1.dsl');
console.log(await kb.export());
```

## 📖 文档导航

| 文档 | 适用场景 |
|------|---------|
| [README.md](./README.md) | 完整使用文档和API文档 |
| [SUMMARY.md](./SUMMARY.md) | 设计总结（本文件） |

## 🎯 应用场景

### 场景1：工作空间知识整合
将页面DSL、组件文档、聚焦信息等整合为一条消息发送给AI

### 场景2：多项目知识库
为不同项目创建不同的知识库，灵活切换

### 场景3：增量知识更新
按需打开/关闭文件，控制发送给AI的信息量

### 场景4：知识库版本管理
通过序列化/反序列化实现知识库的保存和恢复

## 🔧 最佳实践

### ✅ DO

- 使用 `new DirectoryProvider(config)` 创建 Provider
- 为 Provider 设置合理的权重（weight），控制显示顺序
- 在 `metadata` 中存储必要信息（如文件ID、类型等）
- 在 Provider 中实现缓存机制（可选）
- 完善的错误处理（try-catch）
- 合理使用异步操作
- 动态获取最新数据，不缓存结构
- 使用 `hidden` 属性隐藏不需要在目录树中显示的节点
- 使用 `customRootNode` 将目录呈现为文件
- 使用动态文档功能处理运行时生成的内容

### ❌ DON'T

- 在回调中使用大量 if-else（每个 Provider 处理自己的逻辑）
- 硬编码路径判断
- 忽略错误处理
- 缓存文件树结构（应该每次动态获取）
- 过度嵌套目录结构（影响性能）
- Provider 中返回完全静态的数据（失去动态优势）

## 📈 性能考虑

- ✅ **动态加载** - 只在 export 时获取需要的内容
- ✅ **批量操作** - `Promise.all` 同时打开多个文件
- ✅ **内容缓存** - 在回调中实现缓存逻辑（可选）
- ✅ **轻量级** - 不缓存文件树结构，内存占用小

## 🔮 未来扩展

### 可能的增强功能

1. **智能缓存** - 基于时间戳的智能缓存策略
2. **文件监听** - 自动检测文件变更
3. **权限控制** - 控制文件访问权限
4. **版本管理** - 跟踪文件版本变化
5. **全文搜索** - 在知识库中搜索内容
6. **可视化工具** - 图形化展示知识库结构
7. **批量操作** - 批量打开/关闭文件

## 📝 总结

### 核心价值

> **通过 `new DirectoryProvider(config)` 的设计，实现清晰的代码组织和完全动态的数据获取，支持动态文档、权重排序、隐藏节点等高级功能，确保每次导出的都是最新的文件树和内容。**

### 五大亮点

1. **🎯 完全动态** - 每次 export 动态获取最新数据
2. **🔧 代码清晰** - 使用 `new DirectoryProvider(config)` 创建 Provider，代码简洁
3. **⚡ 容错性强** - 自动标记已删除文件
4. **🎨 灵活多样** - 支持动态文档、权重排序、隐藏节点等高级功能
5. **🚀 易于扩展** - 通过配置创建 Provider，无需继承类

### 适用对象

- ✅ 需要向AI发送实时更新的结构化信息的应用
- ✅ 需要灵活组织知识的系统
- ✅ 需要高度可扩展的知识管理框架
- ✅ 需要处理动态变化的文件系统和运行时生成的内容
- ✅ 需要清晰代码组织的项目

---

**现在就开始使用 Knowledges 系统，让你的知识管理更加实时和优雅！** 🚀

查看 [README.md](./README.md) 了解完整的使用文档。

