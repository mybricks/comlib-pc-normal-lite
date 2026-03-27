import type { Project } from '../project';
import syncMarkdownformybricksModule from './syncMarkdownformybricksModule';
import developMyBricksModule from './developMyBricksModuleNext';

const NAME = 'checkDesignStatus';
(checkDesignStatus as any).toolName = NAME;

export interface CheckDesignStatusConfig {
  project: Project;
  onProgress: any;
  /** 本次请求是否成功修改了代码的共享标志 */
  codeModifiedFlag?: { value: boolean };
}

export default function checkDesignStatus(config: CheckDesignStatusConfig): any {
  const { project, onProgress, codeModifiedFlag } = config;

  return {
    name: NAME,
    displayName: '查看当前状态',
    description: `查看搭建态的情况，将会告知当前渲染是否正常渲染，是否有报错，以及渲染了几个页面和弹窗。
在任何代码修改后都应该检查搭建态是否正常，我们特别希望在搭建态能够展示所有页面和弹窗，方便用户进行调试`,
    execute(_params: any, context: any) {
      return new Promise<any>((resolve) => {
        setTimeout(async () => {
          const status = await project.exportDesignerToMessage();

          const hasErrors = project.hasRuntimeErrors();

          const commands: any[] = [];

          if (hasErrors) {
            if (!context.commands?.find((command: any) => command.name === developMyBricksModule.toolName)) {
              commands.push({ toolName: developMyBricksModule.toolName });
            }
          } else {
            onProgress?.('complete')
            if (codeModifiedFlag?.value && !context.commands?.find((command: any) => command.name === syncMarkdownformybricksModule.toolName)) {
              commands.push({ toolName: syncMarkdownformybricksModule.toolName });
              codeModifiedFlag.value = false;
            }
          }

          resolve({
            llmContent: status,
            displayContent: '已查看搭建状态',
            appendCommands: commands.length > 0 ? commands : undefined,
          });
        }, 1000);
      });
    },
  };
}
