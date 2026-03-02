import read from './read';
import glob from './glob';
import grep from './grep';
import developModule from './developMyBricksModuleNext';

const NAME = 'explore';
const CODE_TOOL_NAME = (developModule as any).toolName ?? 'developMyBricksModule';
(explore as any).toolName = NAME;

export default function explore(): any {
  return {
    name: NAME,
    displayName: '探索代码',
    description: `你是一个ReAct Agent，先使用 read、glob、grep 工具探索项目代码，定位需求与策略后，调用其他工具选择下一步操作。
`,
    getPrompts: () => `
<角色>
你是一个 ReAct 模式的代码探索 Agent：通过 grep / glob / read 工具查询和定位代码，定位需求与策略后，调用其他工具选择下一步操作。
</角色>

<定位代码策略>
先根据「用户意图」和「聚焦信息」模糊搜索 -> 再精确定位。高效定位需求范围。
1. 优先使用grep搜索组件名/关键词/用户意图猜测的关键词；
2. 然后用read按需打开文件；
</定位代码策略>

<工作流程>
每次调用，你必须根据现有的状态思考下一步的行动。
下一步行动有两类：
- 调用工具；
- 直接输出信息，表示中断循环，不再需要调用工具；
</工作流程>

<可用工具>
## 可用的搜索工具
### glob — 文件发现
按 glob 模式列出项目中存在的文件路径。
- 何时用：不清楚有哪些文件，或想确认某类文件是否存在
- params.pattern: glob 表达式，如 "**/*.jsx"、"*.less"、"*.json"

### read — 文件读取
读取指定文件的内容，支持按行分段读取。
- 何时用：确认文件路径后，读取具体代码
- params.filePath: 完整路径，如 "/runtime.jsx"
- params.offset: 起始行（1-indexed，默认 1）
- params.limit: 最多读取行数（默认 100）
- 大文件时，根据返回提示的 offset 值继续读取

### grep — 全文搜索
在项目文件中搜索指定模式。
- 何时用：定位特定变量、函数名、API 调用
- params.searchPattern: 正则表达式
- params.fileFilter: 文件名过滤，如 "*.jsx"（可选）

### ${CODE_TOOL_NAME} — 编写/修改组件
根据用户需求，以及各类上下文，一次性编写/修改模块中的所有代码，实现功能。
- 何时用：需要编写/修改模块中的代码时
- params: 无

</可用工具>

<输出格式>
当需要调用工具时，输出 tool.json，支持单条或批量（多条代表并行执行）：
\`\`\`json file="tool.json"
{
  "tools": [
    { "name": "read", "params": { "filePath": "/runtime.jsx", "offset": 1, "limit": 100 }, "reason": "读取 runtime 前 100 行" },
    { "name": "grep", "params": { "searchPattern": "comRef" }, "reason": "搜索组件引用" }
  ]
}
\`\`\`
- tools: 数组；1 个元素为单次调用，多个元素时并行执行。
- name 可选：read | glob | grep | ${CODE_TOOL_NAME}
- params 为对应工具参数，reason 为该条原因。
不需要调用工具时直接输出内容，不要输出 tool.json。
</输出格式>
`,
    execute(params: any) {
      const files = params?.files ?? [];
      const toolFile = files.find((f: any) => f.fileName === 'tool.json' || f.name === 'tool.json');
      const toolString = toolFile?.content ?? '';

      if (!toolString.trim()) {
        return params?.content ?? '';
      }

      let parsed: { name?: string; params?: Record<string, unknown>; reason?: string; tools?: Array<{ name?: string; params?: Record<string, unknown>; reason?: string }> } | null = null;
      try {
        parsed = JSON.parse(toolString);
      } catch {
        parsed = null;
      }

      const toolItems: Array<{ name: string; params: Record<string, unknown>; reason: string }> = [];
      if (Array.isArray(parsed?.tools) && parsed!.tools.length > 0) {
        parsed!.tools.forEach((t: any) => {
          if (t?.name) toolItems.push({ name: t.name, params: t.params ?? {}, reason: t.reason ?? `调用 ${t.name}` });
        });
      } else if (parsed?.name) {
        toolItems.push({ name: parsed.name, params: parsed.params ?? {}, reason: parsed.reason ?? `调用 ${parsed.name}` });
      }

      if (toolItems.length === 0) {
        return params?.content ?? '';
      }

      const appendExplore = { toolName: NAME, params: {} };
      const commands: Array<{ toolName: string; params: Record<string, unknown> }> = [];
      const displayParts: string[] = [];

      for (const item of toolItems) {
        switch (item.name) {
          case 'read':
            commands.push({ toolName: read.name, params: item.params });
            displayParts.push('read');
            break;
          case 'glob':
            commands.push({ toolName: glob.name, params: item.params });
            displayParts.push('glob');
            break;
          case 'grep':
            commands.push({ toolName: grep.name, params: item.params });
            displayParts.push('grep');
            break;
          case CODE_TOOL_NAME:
            commands.push({ toolName: CODE_TOOL_NAME, params: item.params });
            displayParts.push('编写');
            break;
          default:
            break;
        }
      }

      if (commands.length === 0) {
        return params?.content ?? '';
      }

      const lastTool = toolItems[toolItems.length - 1];
      if (lastTool?.name !== CODE_TOOL_NAME) {
        commands.push(appendExplore);
      }

      const llmContent = toolItems.map((t) => `[${t.name}] ${t.reason}`).join('\n');
      const displayLabel: Record<string, string> = { read: '读取文件', glob: '文件列表', grep: '全文搜索', [CODE_TOOL_NAME]: '进入编写' };
      const displayContent =
        toolItems.length === 1 ? (displayLabel[toolItems[0].name] ?? toolItems[0].name) : `批量: ${displayParts.join(', ')}`;

      return {
        llmContent,
        displayContent,
        appendCommands: commands,
      } as any;
    },
  };
}
