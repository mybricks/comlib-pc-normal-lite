// import classLibrarySelection from "./tools/loadExtraComponentDocs"
// import developMyBricksModule from "./tools/developMyBricksModule";
// import readModuleCode from "./tools/read-module-code";
// import answer from "./tools/answer";
// import { createWorkspace } from "./workspace";

/**
 * 更新组件文件
 * @param files 文件数组，每个文件包含 fileName 和 content
 * @param comId 组件ID
 * @param context 上下文对象，包含 updateFile 和 getAiComParams 方法
 */
function updateComponentFiles(files: Array<{ fileName: string; content: string }>, comId: string, context: any) {
  const aiComParams = context.getAiComParams(comId);
  
  const fileToDataKey: Array<{ fileName: string; dataKey: string }> = [
    {
      fileName: 'model.json', dataKey: 'modelConfig'
    },
    {
      fileName: 'runtime.jsx', dataKey: 'runtimeJsxSource'
    },
    {
      fileName: 'style.less', dataKey: 'styleSource'
    },
    {
      fileName: 'config.js', dataKey: 'configJsSource'
    },
    {
      fileName: 'com.json', dataKey: 'componentConfig'
    },
  ];

  fileToDataKey.forEach(({ fileName, dataKey }) => {
    const matchedFiles = files.filter((file: any) => file.fileName === fileName);
    if (matchedFiles.length === 1) {
      context.updateFile(comId, { fileName, content: matchedFiles[0].content })
    } else if (matchedFiles.length > 1) {
      let current = decodeURIComponent(aiComParams.data[dataKey] || '');
      for (let i = 0; i < matchedFiles.length; i+=2) {
        const before = matchedFiles[i];
        const after = matchedFiles[i + 1];

        const index = current.indexOf(before.content);
        if (index === -1) {
          console.error(`[@开发模块 - 文件${fileName}替换失败]`, {
            current,
            before: before.content,
            after: after.content,
          });
        }

        if (before.content === "") {
          current = after.content;
        } else {
          current = current.replace(before.content, after.content)
        }
      }
      context.updateFile(comId, { fileName, content: current })
    }
  });
}

export default function ({ context }) {
  console.log("[@vibeCoding - context]", context);

  return {
    type: "vibeCoding",
    name: '智能组件助手',
    goal: '根据用户需要，开发可运行在浏览器端的JavaScript代码',
    backstory: `基于浏览器端JavaScript API`,
    request({ rxai, params, focus }: any) {
      const aiComParams = context.getAiComParams(focus.comId);
      console.log("[@request - params]", params);
      console.log("[@request - focus]", focus);
      console.log("[aiComParams]", aiComParams);

      return new Promise((resolve, reject) => {
        rxai.requestAI({
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
          // presetMessages: async () => {
          //   const content = await workspace.exportToMessage()
          //   return [
          //     {
          //       role: 'user',
          //       content
          //     },
          //     {
          //       role: 'assistant',
          //       content: '感谢您提供的知识，我会参考这些知识进行开发。'
          //     },
          //   ]
          // },
          tools: [

          ],
          formatUserMessage: (text: string) => {
            return `
<注意>
1. 如果只是为了了解组件的现状，不需要通过历史记录，会在后续执行工具中提供
</注意>
<用户消息>
${text}
</用户消息>
`
          },
        });
      });
    }
  }
}
