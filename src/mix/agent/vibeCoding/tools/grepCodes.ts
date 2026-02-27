import type { Project } from '../project';

const NAME = 'grepCodes';
(grepCodes as any).toolName = NAME;

export interface GrepCodesConfig {
  /** Project 实例，用于调用 read(组件name) 展开代码 */
  project: Project;
}

/**
 * grepCodes：按组件 name 批量展开/读取代码，对接 Project 的 read 操作
 */
export default function grepCodes(config: GrepCodesConfig): any {
  const { project } = config;

  return {
    name: NAME,
    displayName: '内容检索',
    description: `按项目架构中的组件 **name** 批量展开并读取其在项目空间中的代码，用于后续编写或修改。
参数(names)：组件 name 列表，支持批量，多个 name 用英文逗号分隔；
工具分类：信息获取类
何时使用：需要查看或修改某组件的具体实现时，先看「项目空间」中的项目架构树，确定组件 name，再调用本工具传入 name 以展开该组件的代码行。

**特别说明 — 打开整个项目：**
- 传入 **root** 时，会展开整个项目的所有代码文件全文，等同于打开项目全部代码；
- 适合需要全局查看或大范围修改时使用，如 \`names: "root"\`。

**使用策略：**
1. 先看项目架构：preset 中的「1. 项目架构」列出了所有组件的 name、summary、specs；
2. 按 name 展开：传入要查看的组件 name（可多个，逗号分隔），如 \`names: "Sidebar,GlobalHeader"\`；若要查看全部代码则传 \`names: "root"\`；
3. 展开后：后续上下文中「2. 文件系统」会展示这些组件在各代码文件中对应的代码片段，其余行折叠；
4. 避免重复：已通过本工具展开的组件会持续保留在上下文中，无需重复传入。

**重要说明：**
- 所有通过本操作展开的代码仅在当前轮次/上下文中有效；
- 若需再次查看某组件代码，可重新调用本工具传入对应 name。

> 在需要阅读或修改组件实现前，建议先调用本工具展开相关组件的代码。
`,
    execute({ params }: { params?: { names?: string; ids?: string } }) {
      let raw = params?.names ?? params?.ids;

      // 兼容 key 使用错误的情况（与 open-dsl 一致）
      if (!raw && params && Object.keys(params).length > 0) {
        raw = params[Object.keys(params)[0]] as string;
      }

      let names: string[] = []

      if (!raw || typeof raw !== 'string') {
        names = ['root']
      }

      names = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (names.length === 0) {
        names.push('root');
      }

      const validNames = new Set(project.getComponentNames());
      const invalidNames = names.filter((n) => !validNames.has(n));
      if (invalidNames.length > 0) {
        const hint = `以下不是项目架构中的组件 name，请仅传入组件 name（如 DataCard）。有效 name 请查看上文「1. 项目架构」。`;
        throw new Error(hint);
      }

      names.forEach((name) => {
        try {
          project.read(name);
        } catch (err) {
          console.warn(`[grepCodes] read("${name}") failed:`, err);
          throw new Error(
            `读取组件 "${name}" 失败：${(err as Error)?.message ?? err}，请检查项目架构中是否存在该 name`
          );
        }
      });

      const list = names.join('、');
      const isRoot = names.some((n) => n === 'root');
      return {
        llmContent: isRoot
          ? `已展开整个项目所有代码文件全文。后续上下文中「文件系统」将包含完整代码。`
          : `已展开和${list}相关的所有的代码。后续「文件系统」将展示这些关联代码。`,
        displayContent: isRoot ? '已读取相关内容' : `已读取${list}的相关内容`,
      };
    },
  };
}
