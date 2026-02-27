import classLibrarySelection from "./tools/loadExtraComponentDocs"
import developMyBricksModule from "./tools/developMyBricksModule";
import developModule from "./tools/developMyBricksModuleNext";
import readRelated from "./tools/readRelated";
import answer from "./tools/answer";
import { createProject, buildProjectJson } from "./project";
import { multiReplaceFile, type ReplaceResultItem } from "../utils/editReplace";

/** 单文件项：fileName + content */
export type ComponentFileItem = { fileName: string; content: string };

/** 单次 before→after 替换结果（与 utils/editReplace 的 ReplaceResultItem 一致） */
export type { ReplaceResultItem };

/** 单个文件的更新结果 */
export type FileUpdateResult = {
  fileName: string;
  dataKey: string;
  fullReplace: boolean;
  replaceCount: number;
  results: ReplaceResultItem[];
  success: boolean;
};

/** updateComponentFiles 的返回值 */
export type UpdateComponentFilesResult = {
  comId: string;
  fileResults: FileUpdateResult[];
  success: boolean;
};

/**
 * 将指定组件的若干源文件（model.json / runtime.jsx / style.less / config.js / com.json）
 * 写入 context 并同步到组件 data，支持单文件覆盖或多组 before/after 片段替换；最后清空该组件的需求文档。
 * 使用多策略匹配（精确、行 trim、首尾行锚点、空格归一化），并返回每个文件的替换结果。
 */
function updateComponentFiles(
  files: Array<ComponentFileItem>,
  comId: string,
  context: any
): UpdateComponentFilesResult {
  const aiComParams = context.getAiComParams(comId);
  const fileResults: FileUpdateResult[] = [];

  const fileToDataKey: Array<{ fileName: string; dataKey: string }> = [
    { fileName: 'com.json', dataKey: 'componentConfig' },
    { fileName: 'config.js', dataKey: 'configJsSource' },
    { fileName: 'model.json', dataKey: 'modelConfig' },
    { fileName: 'style.less', dataKey: 'styleSource' },
    { fileName: 'runtime.jsx', dataKey: 'runtimeJsxSource' },
  ];

  /** 事务：先计算所有结果，仅当全部成功时才写入；有任一失败则不写任何文件 */
  const pendingWrites: Array<{ fileName: string; content: string }> = [];

  for (const { fileName, dataKey } of fileToDataKey) {
    const matchedFiles = files.filter((f) => f.fileName === fileName);
    if (matchedFiles.length === 0) continue;

    if (matchedFiles.length === 1) {
      fileResults.push({
        fileName,
        dataKey,
        fullReplace: true,
        replaceCount: 1,
        results: [{ ok: true, strategy: 'fullReplace' }],
        success: true,
      });
      pendingWrites.push({ fileName, content: matchedFiles[0].content });
      continue;
    }

    const current = decodeURIComponent(aiComParams.data[dataKey] || '');
    const operations: Array<{ before: string; after: string }> = [];
    for (let i = 0; i < matchedFiles.length; i += 2) {
      const before = matchedFiles[i];
      const after = matchedFiles[i + 1];
      if (!after) continue;
      operations.push({ before: before.content, after: after.content });
    }

    const multi = multiReplaceFile(current, operations);
    if (!multi.ok && multi.results.length > 0) {
      const firstFail = multi.results.find((r) => !r.ok);
      if (firstFail?.message) {
        console.error(`[@开发模块 - 文件${fileName} 替换失败]`, firstFail.message);
      }
    }

    fileResults.push({
      fileName,
      dataKey,
      fullReplace: false,
      replaceCount: multi.results.length,
      results: multi.results,
      success: multi.ok,
    });
    if (multi.ok && multi.newContent !== undefined) {
      pendingWrites.push({ fileName, content: multi.newContent });
    }
  }

  const success = fileResults.every((r) => r.success);
  if (success) {
    for (const { fileName, content } of pendingWrites) {
      context.updateFile(comId, { fileName, content });
    }
    aiComParams.data.document = '';
  }

  return {
    comId,
    fileResults,
    success,
  };
}

/** 将更新结果格式化为给用户/模型展示的文案 */
function formatUpdateResult(result: UpdateComponentFilesResult): string {
  if (result.success) {
    const parts = result.fileResults.map((r) => {
      if (r.fullReplace) return `${r.fileName}（整文件已更新）`;
      return `${r.fileName}`;
    });
    return `修改完成。已更新：${parts.join('；')}`;
  }
  const failed = result.fileResults.filter((r) => !r.success);
  const details = failed.map((r) => {
    const errs = r.results.filter((x) => !x.ok).map((x) => x.message ?? x.error ?? '未知错误');
    return `${r.fileName}: ${errs.join('；')}`;
  });
  return `部分更新失败：${details.join('。')}`;
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
      // const aiComParams = context.getAiComParams(focus.comId);
      const aiCom = context.getAiCom(focus.comId);
      const { aiComParams, actions } = aiCom;

      let comName = "root";

      console.log("[@request - params]", params);
      console.log("[@request - focus]", focus);
      console.log("[aiCom]", aiCom);
      console.log("[aiComParams]", aiComParams);

      // 判断是否作为工具被调用（被上级agent调用）
      const asSubAgentTool = !!params.asTool;

      const onProgress = (status) => {
        console.log("[@comName]", comName);
        console.log("[@status]", status);
        if (comName === "root") {
          params?.onProgress?.(status);
        } else {
          if (status === "start") {
            actions.lock(comName);
          } else if (status === "complete") {
            actions.unlock(comName);
          } else if (status === "error") {
            actions.unlock(comName);
          }
        }
      }

      const focusArea = actions?.getFocusArea?.();

      let focusInfo = "";

      if (focusArea) {
        const cloneEl = focusArea.elemenet.cloneNode(true);
        cloneEl.innerHTML = '';
        cloneEl.innerText = focusArea.elemenet.innerText;
        const loc = JSON.parse(focusArea.elemenet.closest(`[data-loc]`).dataset.loc);
        const runtimeJsxSource = decodeURIComponent(aiComParams.data.runtimeJsxSource);

        comName = focusArea.elemenet.closest(`[data-com-name]`).dataset.comName;

        focusInfo = `
<选区信息>
HTML Element: ${cloneEl.outerHTML}
Component Name: ${comName}
</选区信息>
        `
      }
      // 创建 project 实例（projectJson 由 runtime/style 动态生成，失败时回退 defaultRoot）
      const runtimeContent = (() => {
        try {
          return decodeURIComponent(aiComParams?.data?.runtimeJsxSource ?? '');
        } catch {
          return '';
        }
      })();
      const styleContent = (() => {
        try {
          return decodeURIComponent(aiComParams?.data?.styleSource ?? '');
        } catch {
          return '';
        }
      })();
      const projectJson = buildProjectJson(runtimeContent, styleContent);
      const project = createProject({
        projectJson,
        getRuntimeContent: () => runtimeContent,
        getStyleContent: () => styleContent,
      });

      // project.read('DataCard')
      // return project.exportToMessage().then((message) => {
      //   console.log("[@project.exportToMessage]", message);
      //   return message;
      // });

      const hasAttachments = Array.isArray(params.attachments) && params.attachments?.length > 0;

      onProgress("start");

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
              onProgress?.("complete");
            },
            error: (error: any) => {
              const aiComParams = context.getAiComParams(focus.comId);
              if (aiComParams && aiComParams.data) {
                delete aiComParams.data.loading;
              }
              reject(error);
              onProgress?.("error");
            },
            cancel: () => { },
          },
          presetMessages: async () => {
            const content = await project.exportToMessage()
            return [
              {
                role: 'user',
                content
              },
              {
                role: 'assistant',
                content: '感谢您提供的项目信息，我会参考这些信息进行开发。'
              },
            ]
          },
        };

        // asTool 模式：stream 收到 files 时调用 batchUpdateComponentFiles(files, context)
        const batchUpdateComponentFiles = createBatchUpdateComponentFiles(context);

        // asTool 模式，直接被上级 agent 调用
        const AsToolModeConfig = {
        ...baseConfig,
        planList: [`${developMyBricksModule.toolName} -mode restore`],
        tools: [
          developMyBricksModule({
            enabledBatch: true,
            hasAttachments,
            onStream: batchUpdateComponentFiles,
            onOpenCodes: () => {
              project.read('root')
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
            readRelated({ project }),
            developModule({
              hasAttachments,
              execute(p) {
                const result = updateComponentFiles(p.files ?? [], focus.comId, context);
                return formatUpdateResult(result);
              },
            }),
            answer()
          ],
          formatUserMessage: (text: string) => {
            return `
<注意>
1. 如果只是为了了解组件的现状，不需要通过历史记录，会在后续执行工具中提供
${focusInfo ? "2. 选区消息是当前用户聚焦的组件，仅用于参考。" : ""}
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
