import classLibrarySelection from "./tools/loadExtraComponentDocs"
import developMyBricksModule from "./tools/developMyBricksModule";
import developModule from "./tools/developMyBricksModuleNext";
import readRelated from "./tools/readRelated";
import explore from "./tools/explore";
import read from "./tools/read";
import grep from "./tools/grep";
import glob from "./tools/glob";
import answer from "./tools/answer";
import { createProject, buildProjectJson } from "./project";
import { CodeBase } from "./codeBase";
import { multiReplaceFile, buildFocusInfo } from "../utils";
import type { ReplaceResultItem } from "../utils/editReplace";
import {
  type ComponentFileItem,
  type FileUpdateResult,
  type UpdateComponentFilesResult,
} from "./tools/utils/files";
import syncMarkdownformybricksModule from "./tools/syncMarkdownformybricksModule";
import checkDesignStatus from "./tools/checkDesignStatus";
import { uuid } from "../../../utils";

/** 单文件项：fileName + content */
export type { ComponentFileItem };

/** 单次 before→after 替换结果（与 utils/editReplace 的 ReplaceResultItem 一致） */
export type { ReplaceResultItem };

export type { FileUpdateResult, UpdateComponentFilesResult };

export const SUPPORTED_FILE_EXTENSION = new Set(['jsx', 'less', 'js', 'md'])

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
  /** 事务：先计算所有结果，仅当全部成功时才写入；有任一失败则不写任何文件 */
  const pendingWrites: Array<{ fileName: string; content: string }> = [];

  const fileNames = [...new Set(files.filter((f) => SUPPORTED_FILE_EXTENSION.has(f.fileName.split('.').pop() ?? '')).map((f) => f.fileName))];

  const currentFilesMap = (aiComParams.data.files ?? []).reduce((pre, cur) => {
    pre[cur.fileName] = cur;
    return pre;
  }, {})

  const deleteFileNames = new Set();

  for (const fileName of fileNames) {
    const matchedFiles = files.filter((f) => f.fileName === fileName);
    if (matchedFiles.length === 0) continue;

    const dataKey = fileName;

    if (matchedFiles.length === 1) {

      if (matchedFiles[0].language === "delete") {
        deleteFileNames.add(matchedFiles[0].fileName);
        continue;
      }

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

    const current = decodeURIComponent(currentFilesMap[fileName]?.source || '');
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

  const mergeSuccess = fileResults.every((r) => r.success);
  if (mergeSuccess) {
    // 并发写入所有文件（updateFile 对异步分支返回 Promise，await 等待编译完成）
    // await Promise.all(
    //   pendingWrites.map(({ fileName, content }) =>
    //     Promise.resolve(context.updateFile(comId, { fileName, content }))
    //   )
    // );
    pendingWrites.map(({ fileName, content }) =>
      context.updateFile(comId, { fileName, content })
    )
    aiComParams.data.document = '';
  }

  deleteFileNames.forEach((fileName) => {
    context.updateFile(comId, { fileName, type: "delete" })
  })

  // 收集编译/校验错误（来自 data._errors，只取本次涉及文件的错误）
  const updatedFileNames = new Set(pendingWrites.map((f) => f.fileName));
  const rawErrors: Array<{ file: string; message: string; type?: string }> =
    aiComParams.data._errors ?? [];
  const compileErrors = rawErrors
    .filter((e) => updatedFileNames.has(e.file))
    .map((e) => ({
      file: e.file,
      message: e.message,
      type: (e.type === 'validate' ? 'validate' : 'compile') as 'compile' | 'validate',
    }));

  const compileSuccess = compileErrors.length === 0;


  console.log("[aiCom]", aiComParams);

  return {
    comId,
    fileResults,
    mergeSuccess,
    compileErrors,
    compileSuccess,
    success: mergeSuccess && compileSuccess,
    updateFile: !!(mergeSuccess && pendingWrites.length)
  };
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

      // let comName = "root";

      // console.log("[@request - params]", params);
      // console.log("[@request - focus]", focus);
      // console.log("[aiCom]", aiCom);
      // console.log("[aiComParams]", aiComParams);

      // 判断是否作为工具被调用（被上级agent调用）
      const asSubAgentTool = !!params.asTool;

      // const lockId = uuid() + "_" + comName;
      let lockId = uuid();

      let planAgent;
      let updateFile = false;

      const onProgress = (status) => {
        const { focusArea } = focus;
        if (!focusArea) {
          if (status === "start") {
            // context.startAIPendingVersion(focus.comId, planAgent);
          } else if (status === "complete") {
            // context.addVersion(focus.comId, "ai", planAgent);
          } else if (status === "error") {
            // context.cancelAIPending(focus.comId);
          }
          params?.onProgress?.(status);
        } else {
          if (status === "start") {
            // context.startAIPendingVersion(focus.comId, planAgent);
            actions.lock(lockId, focusArea);
          } else if (status === "complete") {
            // context.addVersion(focus.comId, "ai", planAgent);
            actions.unlock(lockId, focusArea);
          } else if (status === "error") {
            // context.cancelAIPending(focus.comId);
            actions.unlock(lockId, focusArea);
          }
        }
        // console.log("[@comName]", comName);
        // console.log("[@status]", status);
        // console.log("[@lockId]", lockId);
        // if (comName === "root") {
        //   params?.onProgress?.(status);
        // } else {
        //   if (status === "start") {
        //     actions.lock(lockId, comName);
        //   } else if (status === "complete") {
        //     actions.unlock(lockId, comName);
        //   } else if (status === "error") {
        //     actions.unlock(lockId, comName);
        //   }
        // }
      }

      const onUpdateFiles = (p) => {
        const result = updateComponentFiles(p.files ?? [], focus.comId, context);
        if (result.updateFile) {
          if (!updateFile) {
            // 插入记录
            updateFile = true
            context.addVersion(focus.comId, "ai", planAgent);
          } else {
            // 更新记录
            context.updateVersion(focus.comId, planAgent);
          }
        }
        return result
      }

      const focusArea = actions?.getFocusArea?.();

      let focusInfo = "";

      if (focusArea) {
        // comName = focusArea.elemenet.closest(`[data-com-name]`)?.dataset?.comName ?? '';
        focusInfo = buildFocusInfo(focusArea.elemenet);
      }
      // 创建 project 实例（projectJson 由 runtime/style 动态生成，失败时回退 defaultRoot）

      const themesContent = (() => {
        try {
          const { activeThemeId, themes } = aiComParams?.data?.themes ?? {};
          const theme = themes?.find((theme) => theme.id === activeThemeId);
          return '- 设计风格：' + (theme?.vars?.length ? '\n  ui设计参考以下主题变量，css变量已经自动注入页面，直接使用变量即可，禁止重复定义。' + 
          theme?.vars?.reduce((pre, cur) => {
            return pre + `\n  - ${cur.title}： ${cur.propertyName}: ${cur.value}`
          }, "") : '\n  当前项目没有定义主题变量，禁止创造变量，风格根据需求自由发挥即可')
        } catch {
          return '';
        }
      })()

      // const projectJson = buildProjectJson(runtimeContent, styleContent);
      const project = createProject({
        getFiles: () => aiComParams?.data?.files,
        getThemesContent: () => themesContent,
        getDesignerState: () => aiComParams?.data?._designerState,
        getErrors: () => aiComParams?.data?._errors,
      });

      // project.read('DataCard')
      // return project.exportToMessage().then((message) => {
      //   console.log("[@project.exportToMessage]", message);
      //   return message;
      // });

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
            const codeStatus = await project.exportToMessage();
            const designerStatus = await project.exportDesignerToMessage();
            return [
              {
                role: 'user',
                content: designerStatus,
              },
              {
                role: 'assistant',
                content: '收到，我了解了当前设计器的搭建状态视图了。'
              },
              {
                role: 'user',
                content: codeStatus
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

        const formatUserMessage = (text: string) => {
          return `
${focusInfo}
<用户消息>
${text}
</用户消息>
`;
        };

        // agent模式配置：planningCheck 保证「代码开发」前必须调用 readRelated
        const READ_RELATED_NAME = (readRelated as any).toolName;
        const DEVELOP_MODULE_NAME = (developModule as any).toolName;
        const ANSWER_NAME = (answer as any).toolName;

        // 每次请求共享的标志：developModule 成功修改代码后置 true，checkDesignStatus 消费后重置
        const codeModifiedFlag = { value: false };

        const AgentModeConfig = {
          ...baseConfig,
          tools: [
            readRelated({ project }),
            developModule({
              hasAttachments,
              onUpdate: onUpdateFiles,
              codeModifiedFlag,
            }),
            checkDesignStatus({ project, onProgress, codeModifiedFlag }),
            syncMarkdownformybricksModule({
              onUpdate: (p) => {
                const files = p.files;
                const summary = files.find((f) => f.fileName === "summary.md")

                if (summary) {
                  context.updateVersionWithContent(focus.comId, planAgent, {
                    summary: summary.content
                  })
                }
                
                onUpdateFiles({
                  files: summary ? files.filter((f) => f.fileName !== "summary.md") : files
                })
              },
            }),
            answer(),
          ],
          planningCheck: (tools: any[]) => {
            const toolNames = tools.map((t: any) => t[1]);
            const resultTools = [...tools];

            // // 规则1: 如果 读取代码 在最后一个，则添加一个 develope
            // const infoToolNames = [READ_RELATED_NAME];
            // if (toolNames.length > 0 && infoToolNames.includes(toolNames[toolNames.length - 1])) {
            //   resultTools.push(['node', DEVELOP_MODULE_NAME]);
            //   return resultTools;
            // }

            // 规则2: 开发代码前必须调用 readRelated
            const developIndex = toolNames.indexOf(DEVELOP_MODULE_NAME);
            if (developIndex > -1) {
              const hasReadRelated = toolNames.slice(0, developIndex).includes(READ_RELATED_NAME);
              if (!hasReadRelated) {
                resultTools.splice(developIndex, 0, ['node', READ_RELATED_NAME]);
                return resultTools;
              }
            }

            return resultTools;
          },
          historyMessageMode: "expanded",
          formatUserMessage,
          onPlan: (plan) => {
            planAgent = plan;
            params?.onPlan?.(plan);
            onProgress("start");
          }
        };

        // ReAct 模式
        // const codeBase = new CodeBase();
        // codeBase.addFile('/runtime.jsx', () => runtimeContent);
        // codeBase.addFile('/style.less', () => styleContent);
        // const ReActModeConfig = {
        //   ...baseConfig,
        //   presetMessages: async () => {
        //     const content = await Promise.resolve(codeBase.exportToMessage());
        //     return [
        //       { role: 'user' as const, content },
        //       { role: 'assistant' as const, content: '感谢您提供的项目信息，我会参考这些信息进行开发。' },
        //     ];
        //   },
        //   maxAppendDepth: 99,
        //   planList: [`${explore.name}`],
        //   tools: [
        //     explore(),
        //     read({ codeBase }),
        //     grep({ codeBase }),
        //     glob({ codeBase }),
        //     developModule({
        //       hasAttachments,
        //       execute(p) {
        //         return updateComponentFiles(p.files ?? [], focus.comId, context);
        //       },
        //     }),
        //   ],
        //   formatUserMessage,
        // };

        const config = asSubAgentTool ? AsToolModeConfig : AgentModeConfig;
        // 如需 ReAct 模式
        // const config = asSubAgentTool ? AsToolModeConfig : ReActModeConfig;
        rxai.requestAI(config);
      });
    },
    getFocusArea(params) {
      let comName = "root";
      try {
        const { focus } = params;
        const aiCom = context.getAiCom(focus.comId);
        const { actions } = aiCom;
        const focusArea = actions?.getFocusArea?.();
        if (focusArea) {
          comName = focusArea.elemenet.closest(`[data-com-name]`).dataset.comName;
        }

        return comName
      } catch (e) {
        console.error("[@getFocusArea - error]", e);
        return comName;
      }
    }
  }
}
