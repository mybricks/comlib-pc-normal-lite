import developModule from "./tools/developMyBricksModuleNext";
import readRelated from "./tools/readRelated";
import answer from "./tools/answer";
import { createProject } from "./project";
import { buildFocusInfo } from "../utils";
import type { ReplaceResultItem } from "../utils/editReplace";
import { debugLogs } from "../../context/debugLogs";
import mixContext from "../../context";
import {
  type ComponentFileItem,
  type UpdateComponentFilesResult,
  type FileUpdateResult,
  SUPPORTED_FILE_EXTENSION,
  updateComponentFiles,
} from "./tools/utils/files";
import syncMarkdownformybricksModule from "./tools/syncMarkdownformybricksModule";
import syncMeta from './tools/syncMeta'
import checkDesignStatus from "./tools/checkDesignStatus";
import { uuid } from "../../../utils";

/** 单文件项：fileName + content */
export type { ComponentFileItem };

/** 单次 before→after 替换结果（与 utils/editReplace 的 ReplaceResultItem 一致） */
export type { ReplaceResultItem };

export type { FileUpdateResult, UpdateComponentFilesResult };

export default function ({ context }) {
  console.log("[@vibeCoding - context]", context);

  return {
    type: "vibeCoding",
    name: '智能组件助手',
    goal: '根据用户需要，开发可运行在MyBricks平台的模块',
    backstory: `基于React + Less`,
    request({ rxai, params, focus }: any) {
      const { focusArea } = focus;
      const aiCom = context.getAiCom(focus.comId);
      const { aiComParams, actions } = aiCom;

      let lockId = uuid();
      let planAgent;
      let updateFile = false;
      let complete;

      let compileError: any = null
      let runtimeError: any = null

      const events = context.getAiComEvents(focus.comId);
      const offCompileError = events.on("compileError", (error) => {
        compileError = error?.length ? error : null
      })
      const offRuntimeError = events.on("runtimeError", (error) => {
        runtimeError = error
      })

      let lockType;

      const setLock = (type: "lock" | "unlock") => {
        if (lockType === type) {
          return
        }
        lockType = type
        if (!focusArea || (compileError || runtimeError)) {
          // 组件，没有选区或者有报错
          params?.onProgress?.(type === "lock" ? "start" : "complete");
        } else {
          // 区域
          actions[type](lockId, focusArea);
        }
      }

      const onProgress = (status) => {
        if (status === "start") {
          (window as any).__vibeCodingCallbacks__?.onStart?.();
          setLock("lock");
        } else if (status === "complete") {
          (window as any).__vibeCodingCallbacks__?.onComplete?.();
          setLock("unlock");
          offCompileError();
          offRuntimeError();
        } else if (status === "error") {
          (window as any).__vibeCodingCallbacks__?.onError?.();
          setLock("unlock");
          offCompileError();
          offRuntimeError();
        }
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

      const activeFocusArea = actions?.getFocusArea?.();

      let focusInfo = "";

      if (activeFocusArea) {
        focusInfo = buildFocusInfo(activeFocusArea.elemenet);
      }

      const themesContent = (() => {
        try {
          const theme = mixContext.resolveActiveTheme(aiComParams?.data);
          return '- 设计风格：' + (theme?.vars?.length ? '\n  ui设计参考以下主题变量，css变量已经自动注入页面，直接使用变量即可，禁止重复定义。' + 
          theme?.vars?.reduce((pre, cur) => {
            return pre + `\n  - ${cur.title}： ${cur.propertyName}: ${cur.value}${cur.desc ? ` [${cur.desc}]` : ''}`
          }, "") : '\n  当前项目没有定义主题变量，禁止创造变量，风格根据需求自由发挥即可')
        } catch {
          return '';
        }
      })()

      const project = createProject({
        getFiles: () => aiComParams?.data?.files,
        getThemesContent: () => themesContent,
        getCodeRules: () => mixContext.projectConfig.codeRules ?? '',
        getDesignRules: () => mixContext.projectConfig.designRules ?? '',
        getDesignerState: () => aiComParams?.data?._designerState,
        getErrors: () => aiComParams?.data?._errors,
        getLogs: () => debugLogs.get(focus.comId),
        snapshotRuntimeMode: aiComParams?.data?.runtimeMode,
      });

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
              setLock
            }),
            checkDesignStatus({ project, setLock, codeModifiedFlag }),
            syncMeta({
              setLock,
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
          }
        };

        rxai.requestAI(AgentModeConfig);
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
          comName = focusArea.elemenet.closest(`[data-com-name]`)?.dataset?.comName || "root";
        }

        return comName
      } catch (e) {
        console.error("[@getFocusArea - error]", e);
        return comName;
      }
    }
  }
}
