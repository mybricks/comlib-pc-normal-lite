import classLibrarySelection from "./tools/loadExtraComponentDocs"
import developMyBricksModule from "./tools/developMyBricksModuleNext";
import readModuleCode from "./tools/read-module-code";
import answer from "./tools/answer";
import { createWorkspace } from "./workspace";

/** 单文件项：fileName + content */
export type ComponentFileItem = { fileName: string; content: string };

/**
 * 将指定组件的若干源文件（model.json / runtime.jsx / style.less / config.js / com.json）
 * 写入 context 并同步到组件 data，支持单文件覆盖或多组 before/after 片段替换；最后清空该组件的需求文档。
 */
function updateComponentFiles(files: Array<ComponentFileItem>, comId: string, context: any) {
  const aiComParams = context.getAiComParams(comId);

  const fileToDataKey: Array<{ fileName: string; dataKey: string }> = [
    { fileName: 'com.json', dataKey: 'componentConfig' },
    { fileName: 'config.js', dataKey: 'configJsSource' },
    { fileName: 'model.json', dataKey: 'modelConfig' },
    { fileName: 'style.less', dataKey: 'styleSource' },
    { fileName: 'runtime.jsx', dataKey: 'runtimeJsxSource' },
  ];

  fileToDataKey.forEach(({ fileName, dataKey }) => {
    const matchedFiles = files.filter((f) => f.fileName === fileName);
    if (matchedFiles.length === 1) {
      context.updateFile(comId, { fileName, content: matchedFiles[0].content });
    } else if (matchedFiles.length > 1) {
      let current = decodeURIComponent(aiComParams.data[dataKey] || '');
      for (let i = 0; i < matchedFiles.length; i += 2) {
        const before = matchedFiles[i];
        const after = matchedFiles[i + 1];
        if (!after) continue;
        const index = current.indexOf(before.content);
        if (index === -1) {
          console.error(`[@开发模块 - 文件${fileName}替换失败]`, {
            current,
            before: before.content,
            after: after.content,
          });
        }
        if (before.content === '') {
          current = after.content;
        } else {
          current = current.replace(before.content, after.content);
        }
      }
      context.updateFile(comId, { fileName, content: current });
    }
  });

  aiComParams.data.document = '';
}

/**
 * 创建批量更新组件文件的处理器
 * 支持多组件并发更新，当所有核心文件接收完成后统一提交
 */
function createBatchUpdateComponentFiles(context: any) {
  const CORE_FILES = ['com.json', 'model.json', 'style.less', 'runtime.jsx'];
  const componentFileBuffer: Record<string, Record<string, string>> = {};
  const processedFileKeys = new Set<string>();

  type FileItem = {
    fileName: string;
    content: string;
    isComplete: boolean;
    language?: string;
  };

  /**
   * 处理单个组件的文件更新
   * 当组件的所有核心文件都收集完成后，触发实际更新
   */
  function handleComponentFileUpdate(comId: string, fileName: string, content: string) {
    // 初始化组件缓冲区并设置加载状态
    if (!componentFileBuffer[comId]) {
      componentFileBuffer[comId] = {};
      const aiComParams = context.getAiComParams(comId);
      if (aiComParams?.data?.document) {
        aiComParams.data.loading = true;
      }
    }

    // 缓存文件内容
    componentFileBuffer[comId][fileName] = content;

    // 检查是否所有核心文件都已接收
    const receivedFiles = Object.keys(componentFileBuffer[comId]);
    const hasAllCoreFiles = CORE_FILES.every((file) => receivedFiles.includes(file));
    if (!hasAllCoreFiles) return;

    // 转换为文件列表格式并更新组件
    const files = receivedFiles.map((name) => ({
      fileName: name,
      content: componentFileBuffer[comId][name],
    }));
    updateComponentFiles(files, comId, context);

    // 清理加载状态和缓冲区
    const aiComParams = context.getAiComParams(comId);
    if (aiComParams?.data) {
      delete aiComParams.data.loading;
    }
    delete componentFileBuffer[comId];
  }

  /**
   * 解析文件名，提取组件ID和基础文件名
   * 格式: filename@componentId.ext -> { comId, baseFileName }
   */
  function parseFileName(fileName: string) {
    const match = fileName.match(/^(.+)@([^.]+)(\..+)$/);
    return match
      ? { comId: match[2], baseFileName: `${match[1]}${match[3]}` }
      : null;
  }

  /**
   * 规范化输入文件数据为统一格式
   */
  function normalizeFileItems(
    rawFiles: Array<Record<string, unknown>> | Record<string, any> | undefined
  ): FileItem[] {
    if (!rawFiles) return [];

    const items: FileItem[] = [];

    if (Array.isArray(rawFiles)) {
      // 处理数组格式
      rawFiles.forEach((file) => {
        const fileName = (file.fileName as string) ?? '';
        if (fileName) {
          items.push({
            fileName,
            content: (file.content as string) ?? '',
            isComplete: (file.isComplete as boolean) ?? false,
            language: (file.language as string) ?? '',
          });
        }
      });
    } else if (typeof rawFiles === 'object') {
      // 处理对象格式
      Object.entries(rawFiles).forEach(([key, fileOrArr]) => {
        const fileArray = Array.isArray(fileOrArr) ? fileOrArr : [fileOrArr];
        fileArray.forEach((file: any) => {
          const fileName = (file?.fileName ?? key) as string;
          if (fileName) {
            items.push({
              fileName,
              content: (file?.content ?? '') as string,
              isComplete: (file?.isComplete ?? false) as boolean,
              language: (file?.language ?? '') as string,
            });
          }
        });
      });
    }

    return items;
  }

  /**
   * 按组件和文件名分组文件项
   */
  function groupFilesByComponent(items: FileItem[]) {
    const groups = new Map<string, { comId: string; baseFileName: string; items: FileItem[] }>();

    items.forEach((item) => {
      const parsed = parseFileName(item.fileName);
      if (!parsed) return;

      const key = `${parsed.comId}|${parsed.baseFileName}`;
      if (!groups.has(key)) {
        groups.set(key, {
          comId: parsed.comId,
          baseFileName: parsed.baseFileName,
          items: [],
        });
      }
      groups.get(key)!.items.push(item);
    });

    return groups;
  }

  /**
   * 从文件项组中提取最终内容
   * 支持 before/after 模式和单文件模式
   */
  function extractFinalContent(items: FileItem[]): string | null {
    const hasBeforeAfterMode = items.some(
      (item) => item.language === 'before' || item.language === 'after'
    );

    if (hasBeforeAfterMode) {
      // before/after 替换模式
      const beforeComplete = items.some(
        (item) => item.language === 'before' && item.isComplete
      );
      const afterItem = items.find(
        (item) => item.language === 'after' && item.isComplete
      );
      return beforeComplete && afterItem ? afterItem.content : null;
    } else {
      // 单文件完整替换模式
      const singleItem = items.find(
        (item) => item.isComplete && item.content.length > 0
      );
      return singleItem?.content ?? null;
    }
  }

  /**
   * 批量更新组件文件的主函数
   */
  function batchUpdateComponentFiles(
    rawFiles: Array<Record<string, unknown>> | Record<string, any> | undefined
  ) {
    const fileItems = normalizeFileItems(rawFiles);
    const fileGroups = groupFilesByComponent(fileItems);

    fileGroups.forEach((group, groupKey) => {
      // 跳过已处理的文件
      if (processedFileKeys.has(groupKey)) return;

      const { comId, baseFileName, items } = group;
      const finalContent = extractFinalContent(items);

      // 内容未就绪，跳过
      if (finalContent === null) return;

      // 标记为已处理
      processedFileKeys.add(groupKey);

      // 日志输出
      const contentPreview = finalContent.length > 80
        ? `${finalContent.slice(0, 80)}...`
        : finalContent;
      console.log('[开发模块 - 文件更新]', {
        comId,
        fileName: baseFileName,
        contentLength: finalContent.length,
        contentPreview,
      });

      // 触发组件文件更新
      handleComponentFileUpdate(comId, baseFileName, finalContent);
    });
  }

  return batchUpdateComponentFiles;
}

export default function ({ context }) {
  console.log("[@vibeCoding - context]", context);

  return {
    type: "vibeCoding",
    name: '智能组件助手',
    goal: '根据用户需要，开发可运行在MyBricks平台的模块',
    backstory: `基于React + Less`,
    request({ rxai, params, focus }: any) {
      const aiComParams = context.getAiComParams(focus.comId);
      console.log("[@request - params]", params);
      console.log("[@request - focus]", focus);
      console.log("[aiComParams]", aiComParams);

      // 判断是否作为工具被调用（被上级agent调用）
      const asSubAgentTool = !!params.asTool;

      params?.onProgress?.("start");

      const { focusArea } = aiComParams ?? {};

      let focusInfo = "";

      if (focusArea) {
        const cloneEl = focusArea.ele.cloneNode(true);
        cloneEl.innerHTML = '';
        cloneEl.innerText = focusArea.ele.innerText;
        const loc = JSON.parse(focusArea.ele.closest(`[data-loc]`).dataset.loc);
        const runtimeJsxSource = decodeURIComponent(aiComParams.data.runtimeJsxSource).replace(/import css from ['"][^'"]*style.less['"]/, 'const css = new Proxy({}, { get(target, key) { return key } })');

        focusInfo = `
<选区信息>
HTML Element: ${cloneEl.outerHTML}
Focus Area Code: ${runtimeJsxSource.slice(loc.jsx.start, loc.tag.end)}
Selector: ${focus.focusArea.selector}
</选区信息>
        `
      }
      // 创建workspace实例
      const workspace = createWorkspace({
        comId: focus.comId,
        aiComParams,
        libraryDocs: [] // 备用的类库文档（可选）
      });

      const hasAttachments = Array.isArray(params.attachments) && params.attachments?.length > 0;

      return new Promise((resolve, reject) => {
        // 基础配置（放在 Promise 内，以便 emits 能正确使用 resolve/reject）
        const baseConfig = {
          ...params,
          emits: {
            write: () => { },
            complete: () => {
              const aiComParams = context.getAiComParams(focus.comId);
              if (aiComParams && aiComParams.data) {
                delete aiComParams.data.loading;
              }
              resolve('complete');
              params?.onProgress?.("complete");
            },
            error: (error: any) => {
              const aiComParams = context.getAiComParams(focus.comId);
              if (aiComParams && aiComParams.data) {
                delete aiComParams.data.loading;
              }
              reject(error);
              params?.onProgress?.("error");
            },
            cancel: () => { },
          },
          presetMessages: async () => {
            const content = await workspace.exportToMessage()
            return [
              {
                role: 'user',
                content
              },
              {
                role: 'assistant',
                content: '感谢您提供的知识，我会参考这些知识进行开发。'
              },
            ]
          },
        };

        // asTool 模式：按组件维度批量更新；onStream(files) 时调用 batchUpdateComponentFiles(files, context)
        const batchUpdateComponentFiles = createBatchUpdateComponentFiles(context);

        // asTool模式，直接被上级agent调用
        const AsToolModeConfig = {
        ...baseConfig,
        planList: [`${developMyBricksModule.toolName} -mode restore`],
        tools: [
          developMyBricksModule({
            enabledBatch: true,
            hasAttachments,
            onStream: batchUpdateComponentFiles,
            onOpenCodes: () => {
              workspace.openModuleCodes()
            },
          }),
          answer()
        ],
        formatUserMessage: (text: string) => {
          const style = aiComParams?.style ?? {};
          const wUnit = typeof style.width === 'number' ? 'px' : '';
          const hUnit = typeof style.height === 'number' ? 'px' : '';
          const componentInfo =
            style.widthFact != null && style.heightFact != null
              ? `宽度为${style.width ?? ''}${wUnit}，实际渲染宽度为${style.widthFact}px；高度为${style.height ?? ''}${hUnit}，实际渲染高度为${style.heightFact}px`
              : '暂无尺寸信息';

          return `<当前组件的信息>
${componentInfo}
</当前组件的信息>
<用户消息>
${text}
</用户消息>
`;
        },
        };

        // agent模式配置
        const AgentModeConfig = {
          ...baseConfig,
          tools: [
            // classLibrarySelection({
            //   librarySummaryDoc: workspace.getAvailableLibraryInfo() || '',
            //   fileFormat: context.plugins.aiService.fileFormat,
            //   onOpenLibraryDoc: (libs) => {
            //     workspace.openLibraryDoc(libs)
            //   }
            // }),
            readModuleCode({
              onOpenCodes: () => {
                workspace.openModuleCodes()
              }
            }),
            developMyBricksModule({
              hasAttachments,
              onOpenCodes: () => {
                workspace.openModuleCodes()
              },
              execute(p) {
                updateComponentFiles(p.files ?? [], focus.comId, context);
              },
            }),
            answer()
          ],
          formatUserMessage: (text: string) => {
            return `
<注意>
1. 如果只是为了了解组件的现状，不需要通过历史记录，会在后续执行工具中提供
${focusInfo ? "2. 关注选区信息，用户信息是针对选区提出的" : ""}
</注意>
${focusInfo}
<用户消息>
${text}
</用户消息>
`
          },
        };

        const config = asSubAgentTool ? AsToolModeConfig : AgentModeConfig;
        rxai.requestAI(config);
      });
    }
  }
}
