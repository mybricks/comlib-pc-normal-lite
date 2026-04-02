import type { Project } from '../project';
import syncMarkdownformybricksModule from './syncMarkdownformybricksModule';
import developMyBricksModule from './developMyBricksModuleNext';

const NAME = 'checkDesignStatus';
(checkDesignStatus as any).toolName = NAME;

export interface CheckDesignStatusConfig {
  project: Project;
  /** 本次请求是否成功修改了代码的共享标志 */
  codeModifiedFlag?: { value: boolean };
  setLock: (type: 'lock' | 'unlock') => void;
}

export default function checkDesignStatus(config: CheckDesignStatusConfig): any {
  const { project, setLock, codeModifiedFlag } = config;

  return {
    name: NAME,
    displayName: '查看当前状态',
    description: `查看当前渲染情况，包含所处环境（设计态/运行态）、渲染页面和弹窗情况（渲染了几个页面和弹窗）、运行日志（用于排查问题）、报错信息（如果有）。
在任何代码修改后都应该检查渲染情况是否正常。
同时，我们特别希望在设计态能够展示所有页面和弹窗，方便用户进行调试。`,
    execute(_params: any, context: any) {
      return new Promise<any>((resolve) => {
        setTimeout(async () => {
          const status = await project.exportDesignerToMessage();
          const logsSection = project.exportLogsToMessage();

          const hasErrors = project.hasRuntimeErrors();

          const commands: any[] = [];

          setLock('unlock')

          if (hasErrors) {
            if (!context.commands?.find((command: any) => command.name === developMyBricksModule.toolName)) {
              commands.push({ toolName: developMyBricksModule.toolName });
            }
          } else {
            if (codeModifiedFlag?.value && !context.commands?.find((command: any) => command.name === syncMarkdownformybricksModule.toolName)) {
              commands.push({ toolName: syncMarkdownformybricksModule.toolName });
              codeModifiedFlag.value = false;
            }
          }

          resolve({
            llmContent: status + logsSection,
            displayContent: '已查看搭建状态',
            appendCommands: commands.length > 0 ? commands : undefined,
          });
        }, 1000);
      });
    },
  };
}
