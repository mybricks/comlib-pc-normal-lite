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
    description: `按代码中的组件名称批量展开并读取其组件范围内的代码，仅能打开指定组件范围内的，父级组件代码需要指定父级名称，组件范围参考组件结构树。
参数(names)：组件 name 列表（name是代码中的comRef组件变量定义），支持批量，多个 name 用英文逗号分隔；
工具分类：信息获取类

**特别说明 **
- 传入 **root**（等同于export default的组件，也就是根组件） 时，会展开整个项目的所有代码。

**核心策略：**
1. 读取文件中的代码以及组件结构树，猜测需求大概可能修改的组件;
2. 关注组件是否定义了 Props，往上查询，猜测需求可能需要覆盖的最大范围的组件；
3. 找到所有引用该组件的父级文件，如果有父级则继续上找，确保能够同时看到“组件是如何定义的”以及“数据是如何传入的”，才能保证代码足够全面。

**重要说明：**
- 所有通过本操作获取的信息仅在当前轮次/上下文中有效；

> !IMPORTANT: 在需要阅读或修改开发前，必须先调用本工具获取相关组件的信息。
`,
    execute({ params }: { params?: { names?: string; ids?: string } }) {
      project.read('root');
      return {
        llmContent: `已展开整个项目所有代码文件全文。后续上下文中「文件系统」将包含完整代码。`,
        displayContent: '已获取相关信息',
      }

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
