/**
 * Workspace - 工作空间知识库
 * 用于管理组件代码和类库文档，并构建presetMessages
 */

import { KnowledgeBase } from './knowledges/knowledge-base';
import { DirectoryProvider, IKnowledgeNode, KnowledgeNodeType, IFileInfo } from './knowledges/types';

import antdPrompt from "./../../../prompts/antd-summary.md"
import echartsPrompt from "./../../../prompts/echarts-summary.md"
import iconPrompt from "./../../../prompts/icon-summary.md"

import { ANTD_KNOWLEDGES_MAP, ECHARTS_KNOWLEDGES_MAP } from '../../../knowledges'

import { getLibraryDoc } from './../../../avaliableLibraries'

function getLibraryDocumentation() {
  return antdPrompt + `\n\n` + echartsPrompt;
}

function loadKnowledge (items) {
  const rtn: any = []
  items.forEach((now) => {
    const library = now.from || now.lib

    // 加载antd知识
    if (library === 'antd') {
      const knowledge = ANTD_KNOWLEDGES_MAP[now.item.toUpperCase()]
      if (knowledge) {
        rtn.push({
          lib: library,
          item: now.item,
          knowledge,
        })
      }
    }

    // 加载echarts知识
    if (library === 'echarts-for-react') {
      const knowledge = ECHARTS_KNOWLEDGES_MAP[now.item.toLowerCase()]

      // @ts-ignore
      if (typeof ECHARTS_KNOWLEDGES_MAP['base']?.docs === 'string') {
        // @ts-ignore
        ECHARTS_KNOWLEDGES_MAP['base']?.docs = ECHARTS_KNOWLEDGES_MAP['base']?.docs.replace(/import ReactECharts from 'echarts-for-react'/g, `import { 图表占位 } from 'echarts-for-react'`).replace(/ReactECharts/g, '图表占位')
      }
      if (typeof ECHARTS_KNOWLEDGES_MAP['base'] === 'string') {
        ECHARTS_KNOWLEDGES_MAP['base'] = ECHARTS_KNOWLEDGES_MAP['base'].replace(/import ReactECharts from 'echarts-for-react'/g, `import { 图表占位 } from 'echarts-for-react'`).replace(/ReactECharts/g, '图表占位')
      }

      // echarts 需要一份 base 的文档
      rtn.push({
        lib: library,
        item: '基础知识',
        knowledge: ECHARTS_KNOWLEDGES_MAP['base'],
      })

      if (knowledge) {
        rtn.push({
          lib: library,
          item: now.item,
          knowledge,
        })
      }
    }

    // if (library.startsWith("@dnd-kit")) {
    //   const knowledge = DNDKIT_KNOWLEDGES_MAP[now.item.toUpperCase()]
    //   if (knowledge) {
    //     rtn.push({
    //       lib: library,
    //       item: now.item,
    //       knowledge,
    //     })
    //   }
    // }
  })

  return rtn
}

export interface WorkspaceConfig {
  /** 组件ID */
  comId: string;
  /** 组件参数（包含data等信息） */
  aiComParams: any;
  /** 类库文档列表 */
  libraryDocs?: Array<{
    /** 类库名称（如 antd） */
    lib: string;
    /** 组件名称（如 Button） */
    item: string;
    /** 文档内容（markdown格式） */
    content: string;
  }>;
}

/**
 * 必需的文件结构
 * 用于确保组件代码目录中始终包含这些文件
 */
const REQUIRED_FILES: Array<{ fileName: string; extname: string; description: string }> = [
  { fileName: 'runtime.jsx', extname: '.jsx', description: '运行时文件' },
  { fileName: 'style.less', extname: '.less', description: '样式代码' },
  { fileName: 'model.json', extname: '.json', description: 'model声明' },
  { fileName: 'config.js', extname: '.js', description: '配置声明文件' },
  { fileName: 'com.json', extname: '.json', description: '当前模块的输入端口（inputs）和输出端口（outputs）的声明文件' }
];

/**
 * Workspace 类
 * 管理组件代码和类库文档的知识库
 */
export class Workspace {
  private knowledgeBase: KnowledgeBase;
  private config: WorkspaceConfig;

  constructor(config: WorkspaceConfig) {
    this.config = config;

    // 初始化知识库
    this.knowledgeBase = new KnowledgeBase({
      name: '项目和知识库',
      description: '包含当前组件代码和各类知识文档'
    });

    // 注册组件代码目录提供者
    this.registerComponentCodeProvider();

    // 注册类库文档目录提供者
    this.registerLibraryDocsProvider();


    // 默认打开组件代码文件
    this.openDefaultFiles();
  }

  /**
   * 注册组件代码目录提供者
   * 提供 runtime.jsx, style.less, config.js 等文件
   */
  private registerComponentCodeProvider() {
    const self = this;
    
    const componentCodeProvider = new DirectoryProvider({
      id: 'component-code',
      name: '组件代码',
      description: '',
      weight: 100, // 最高权重，排在最前面
      hidden: false,

      getChildren: async (parentId: string): Promise<IKnowledgeNode[]> => {
        if (parentId !== 'component-code') {
          return [];
        }
        return REQUIRED_FILES.map(file => {
          return {
            id: file.fileName,
            name: file.fileName.replace(file.extname, ''),
            type: KnowledgeNodeType.FILE,
            extname: file.extname,
            description: file.description,
            metadata: { providerId: 'component-code' }
          }
        });
      },

      readFile: async (fileInfo: IFileInfo): Promise<string> => {
        const { aiComParams } = self.config;
        const data = aiComParams?.data || {};

        const fileName = fileInfo.name + fileInfo.extname;

        switch (fileName) {
          case 'runtime.jsx': {
            let runtimeCode = data.runtimeJsxSource ?? ''
            try {
              runtimeCode = decodeURIComponent(runtimeCode)
            } catch (error) {
              runtimeCode = ''
              console.error('[Workspace.readFile] 获取runtime.jsx失败:', error);
            }
            return runtimeCode
          }
          case 'style.less': {
            let styleCode = data.styleSource ?? ''
            try {
              styleCode = decodeURIComponent(styleCode)
            } catch (error) {
              styleCode = ''
              console.error('[Workspace.readFile] 获取style.less失败:', error);
            }
            return styleCode
          }
          case 'model.json': {
            let modelCode = data.modelConfig ?? ''
            try {
              modelCode = decodeURIComponent(modelCode)
            } catch (error) {
              modelCode = ''
              console.error('[Workspace.readFile] 获取model.json失败:', error);
            }
            return modelCode
          }
          case 'config.js': {
            let configCode = data.configJsSource ?? ''
            try {
              configCode = decodeURIComponent(configCode)
            } catch (error) {
              configCode = ''
              console.error('[Workspace.readFile] 获取config.js失败:', error);
            }
            return configCode
          }
          case 'com.json': {
            let componentConfigCode = data.componentConfig ?? ''
            try {
              componentConfigCode = decodeURIComponent(componentConfigCode)
            } catch (error) {
              componentConfigCode = ''
              console.error('[Workspace.readFile] 获取com.json失败:', error);
            }
            return componentConfigCode
          }
          default:
            return data[fileName] || '';
        }
      }
    });

    this.knowledgeBase.registerProvider(componentCodeProvider);
  }

  /**
   * 注册类库文档目录提供者
   * 提供所有可用的类库文档（markdown格式）
   */
  private registerLibraryDocsProvider() {
    // // 注册动态组件文档目录
    // this.knowledgeBase.registerDynamicDirectory({
    //   id: 'library-component-docs',
    //   name: '组件使用文档',
    //   description: '组件级别的补充文档',
    //   weight: 85, // 第三高权重
    //   hidden: false
    // });

    // 注册动态组件文档目录
    this.knowledgeBase.registerDynamicDirectory({
      id: 'library-component-docs',
      name: '允许使用的类库',
      description: '允许使用的各类三方库文档',
      weight: 85, // 第三高权重
      hidden: false
    });
  }

  /**
   * 初始化类库信息
   * 加载并打开静态的类库说明文档
   */
  getAvailableLibraryInfo() {
    try {
      // 获取类库说明文档
      return getLibraryDocumentation();
    } catch (error) {
      console.error('[Workspace] 初始化类库信息失败:', error);
    }
  }

  openModuleCodes() {
    try {
      const { aiComParams } = this.config;
      const data = aiComParams?.data || {};

      // 获取所有文件键（排除内部属性）
      const allFileKeys = Object.keys(data).filter(key => 
        !key.startsWith('_') && typeof data[key] === 'string'
      );

      // 获取必需文件的文件名集合
      const requiredFileNames = new Set(REQUIRED_FILES.map(f => f.fileName));

      // 优先打开必需文件（即使内容为空）
      const filesToOpen = new Set<string>();
      
      // 1. 先添加所有必需文件
      for (const required of REQUIRED_FILES) {
        filesToOpen.add(required.fileName);
      }
      
      // 2. 再添加其他有内容的文件
      for (const fileName of allFileKeys) {
        if (!requiredFileNames.has(fileName) && data[fileName]?.trim()) {
          filesToOpen.add(fileName);
        }
      }

      filesToOpen.forEach(async (fileName) => {
        await this.knowledgeBase.openFile(`component-code/${fileName}`);
      });
    } catch (error) {
      console.error('[Workspace.openModuleCodes] 打开模块代码失败:', error);
    }
  }

  /**
   * 默认打开类库文档
   * 优先打开必需文件，然后打开其他有内容的文件
   */
  private async openDefaultFiles() {
    try {
      await this.openLibraryDoc(['antd', '@ant-design/icons', 'dayjs'])
    } catch (error) {
      
    }
  }

  // /**
  //  * 打开类库文档
  //  */
  // async openLibraryDoc(libs: any[] = []) {
  //   const componentKnowledges = loadKnowledge(libs)

  //   componentKnowledges.forEach(async (componentKnowledge) => {
  //     await this.knowledgeBase.openDynamicDocument({
  //       id: `component-doc-${componentKnowledge?.lib}.${componentKnowledge.item}`,
  //       title: componentKnowledge?.item,
  //       description: componentKnowledge?.knowledge?.description,
  //       content: componentKnowledge?.knowledge?.docs,
  //       directoryId: 'library-component-docs',
  //       extname: '.md'
  //     });
  //   });
  // }

  async openLibraryDoc(libs: string[] = []) {
    return libs.forEach(async (lib) => {
      await this.knowledgeBase.openDynamicDocument({
        id: lib.replace('/', '-'),
        title: `${lib}使用文档`,
        description: lib,
        content: getLibraryDoc(lib),
        directoryId: 'library-component-docs',
      });
    });
  }

  /**
   * 获取知识库导出内容（用于presetMessages）
   */
  async exportToMessage(): Promise<string> {
    return await this.knowledgeBase.export({
      includeTree: true
    });
  }
}

/**
 * 创建workspace实例的工厂函数
 */
export function createWorkspace(config: WorkspaceConfig): Workspace {
  return new Workspace(config);
}

export default Workspace;
