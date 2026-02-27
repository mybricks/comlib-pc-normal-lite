import type { Project } from '../project';
import { ROOT_NAME } from '../project';

const NAME = 'readRelated';
(readRelated as any).toolName = NAME;

export interface ReadRelatedConfig {
  /** Project 实例，用于调用 read(组件name) 展开代码 */
  project: Project;
}

/**
 * readRelated：按组件 name 批量展开/读取关联代码，对接 Project 的 read 操作
 */
export default function readRelated(config: ReadRelatedConfig): any {
  const { project } = config;

  return {
    name: NAME,
    displayName: '获取相关信息',
    description: `按项目架构中的组件 **name** 批量获取其在项目空间中的**相关信息**（代码实现）。
参数(names)：组件 name 列表，支持批量，多个 name 用英文逗号分隔；
工具分类：信息获取类
何时使用：需要查看或修改某组件的具体实现时，先看「项目架构」，确定组件 name，再调用本工具传入 name 以获取该组件的关联代码。

**特别说明 — 打开整个项目：**
- 传入 **root** 时，会展开整个项目的所有代码文件全文，适合需要全局查看或大范围修改时使用。

**使用策略：**
1. 先看项目架构：preset 中的「1. 项目架构」列出了所有组件的 name、summary、specs；
2. 按 name 获取：传入要查看的组件 name（可多个，逗号分隔），如 \`names: "Sidebar,GlobalHeader"\`；若要查看全部代码则传 \`names: "root"\`；
3. 获取后：后续上下文中「2. 文件系统」会展示这些组件在各代码文件中对应的关联代码片段，其余行折叠；
4. 避免重复：已获取的组件信息会持续保留在上下文中，无需重复传入。

**重要说明：**
- 所有通过本操作获取的信息仅在当前轮次/上下文中有效；
- 若需再次查看某组件代码，可重新调用本工具传入对应 name。

> 在需要阅读或修改组件实现前，建议先调用本工具获取相关组件的信息。
`,
    execute({ params }: { params?: { names?: string; ids?: string } }) {
      let raw = params?.names ?? params?.ids;

      // 兼容 key 使用错误的情况（与 open-dsl 一致）
      if (!raw && params && Object.keys(params).length > 0) {
        raw = params[Object.keys(params)[0]] as string;
      }

      let names: string[] = []

      if (raw && typeof raw === 'string') {
        names = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (names.length === 0) {
        names.push(ROOT_NAME);
      }

      const componentNames = project.getComponentNames();
      const validNames = new Set([...componentNames, ROOT_NAME]);
      const invalidNames = names.filter((n) => !validNames.has(n));
      if (invalidNames.length > 0) {
        const invalidHint = `参数有误，请从上下文获取合理的参数。`;
        throw new Error(invalidHint);
      }

      names.forEach((name) => {
        try {
          project.read(name);
        } catch (err) {
          console.warn(`[readRelated] read("${name}") failed:`, err);
          throw new Error(
            `获取组件 "${name}" 信息失败：${(err as Error)?.message ?? err}，请检查项目架构中是否存在该 name`
          );
        }
      });

      const list = names.join('、');
      const isRoot = names.some((n) => n === ROOT_NAME);
      return {
        llmContent: isRoot
          ? `已展开整个项目所有代码文件全文。后续上下文中「文件系统」将包含完整代码。`
          : `已获取 ${list} 相关的所有的代码。后续「文件系统」将展示这些关联代码。`,
        displayContent: isRoot ? '已获取相关信息' : `已获取 ${list} 的相关信息`,
      };
    },
  };
}
