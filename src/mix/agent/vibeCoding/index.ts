import classLibrarySelection from "./tools/loadExtraComponentDocs"
import developMyBricksModule from "./tools/developMyBricksModule";
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
    { fileName: 'model.json', dataKey: 'modelConfig' },
    { fileName: 'runtime.jsx', dataKey: 'runtimeJsxSource' },
    { fileName: 'style.less', dataKey: 'styleSource' },
    { fileName: 'config.js', dataKey: 'configJsSource' },
    { fileName: 'com.json', dataKey: 'componentConfig' },
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
 * 按文件维度更新：供 agent 按 (comId, fileName, content) 单文件调用，内部汇总后走 updateComponentFiles。
 */
function createOnComponentUpdate(context: any) {
  return function onComponentUpdate(comId: string, fileName: string, content: string) {
    updateComponentFiles([{ fileName, content }], comId, context);
  };
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
              resolve('complete');
              params?.onProgress?.("complete");
            },
            error: (error: any) => {
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

        const onComponentUpdate = createOnComponentUpdate(context);

        // asTool模式，直接被上级agent调用
        const AsToolModeConfig = {
        ...baseConfig,
        planList: [`${developMyBricksModule.toolName} -mode restore`],
        tools: [
          developMyBricksModule({
            enabledBatch: true,
            hasAttachments,
            onComponentUpdate,
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
