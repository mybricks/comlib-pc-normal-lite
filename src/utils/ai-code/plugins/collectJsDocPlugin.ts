/**
 * Babel 插件：collectJsDocPlugin
 *
 * 通过 AST 分析，收集代码中 appRef、comRef、popupRef 节点对应的 @mybricks JSDoc，
 * 将 JSDoc 字符串解析为结构化数据，以「声明的组件变量名」或「文件名（备选）」为 key，
 * 写入调用方传入的 `result` Map 中。
 *
 * 支持的声明形式：
 *   const XXX = comRef(...)          → key 为 "XXX"
 *   const XXX = popupRef(...)        → key 为 "XXX"
 *   export default comRef(...)       → key 为 fallbackName（文件名派生）
 *   export default appRef(...)       → key 为 "default"
 *
 * 用法示例：
 * ```ts
 * import { transform } from "@babel/core";
 * import collectJsDocPlugin from "./plugins/collectJsDocPlugin";
 *
 * const jsdocMap = new Map<string, import("./utils/parseMybricksJSDoc").MybricksJSDoc>();
 * transform(code, {
 *   plugins: [[collectJsDocPlugin, { result: jsdocMap, fileName: "src/LoginForm.tsx" }]],
 * });
 * // jsdocMap.get("LoginForm") → { name: "LoginForm", title: "...", ... }
 * ```
 */

import { parseMybricksJSDoc, MybricksJSDoc } from "./utils/parseMybricksJSDoc";
import {
  isAppRefCall,
  isComRefCall,
  isPopupRefCall,
} from "./utils/comRef";

/** 从文件路径派生组件名：folder/index.jsx → folder 名；直接文件 → 文件名（去扩展名） */
function deriveNameFromFilePath(filePath?: string): string {
  if (!filePath) return "root";
  const parts = filePath.replace(/\\/g, "/").split("/");
  const last = parts[parts.length - 1];
  const stem = last.replace(/\.[^.]+$/, "");
  if (stem === "index" && parts.length > 1) {
    return parts[parts.length - 2];
  }
  return stem || "root";
}

/**
 * 从 AST 节点上提取 @mybricks JSDoc：
 * - VariableDeclarator → 从父级 VariableDeclaration 的 leadingComments 取（Babel 把注释挂在 VariableDeclaration）
 * - ExportDefaultDeclaration → 从自身 leadingComments 取
 *
 * 返回解析后的 MybricksJSDoc 或 null。
 */
function extractMybricksJSDocFromNode(
  astNode: any,
  parentNode: any
): MybricksJSDoc | null {
  let comments: any[] | undefined;

  if (astNode.type === "ExportDefaultDeclaration") {
    comments = astNode.leadingComments;
  } else {
    // VariableDeclarator：注释挂在父级 VariableDeclaration 上
    comments = parentNode?.leadingComments ?? astNode.leadingComments;
  }

  if (!Array.isArray(comments) || comments.length === 0) return null;

  // 找最近一个 CommentBlock，并尝试解析 @mybricks
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (comment.type === "CommentBlock" && typeof comment.value === "string") {
      const parsed = parseMybricksJSDoc(comment.value);
      if (parsed) return parsed;
    }
  }

  return null;
}

export interface CollectJsDocPluginOptions {
  /**
   * 收集结果写入此 Map。
   * key: 组件变量名（或文件名 fallback）
   * value: 解析后的 MybricksJSDoc 结构
   */
  result: Map<string, MybricksJSDoc>;
  /** 当前文件路径，用于 export default 场景的 fallback key */
  fileName?: string;
}

/**
 * Babel 插件工厂函数。
 * 以 `[collectJsDocPlugin, { result, fileName }]` 方式传入 Babel plugins 数组。
 */
export default function collectJsDocPlugin(
  _babel: any,
  options: CollectJsDocPluginOptions
) {
  const { result, fileName } = options;
  const fallbackName = deriveNameFromFilePath(fileName);

  return {
    visitor: {
      /**
       * 处理：const XXX = comRef(...) / popupRef(...)
       * 注意：appRef 通常只以 export default appRef(...) 出现，VariableDeclarator 不处理 appRef。
       */
      VariableDeclarator(path: any) {
        try {
          const { node } = path;
          const { id, init } = node;

          if (!id || id.type !== "Identifier") return;
          if (!init || init.type !== "CallExpression") return;

          const { callee } = init;

          const isRef =
            isComRefCall(callee) ||
            isPopupRefCall(callee);

          if (!isRef) return;

          const componentName: string = id.name;
          // VariableDeclarator 的注释挂在父级 VariableDeclaration（path.parentPath.node）
          const parentNode = path.parentPath?.node ?? null;
          const jsdoc = extractMybricksJSDocFromNode(node, parentNode);

          if (jsdoc) {
            result.set(componentName, jsdoc);
          }
        } catch {
          // 忽略单节点解析错误，不影响整体
        }
      },

      /**
       * 处理：export default appRef(...) / comRef(...) / popupRef(...)
       * 此时没有变量名，fallback 使用文件名派生的名称；appRef 特殊使用 "default"。
       */
      ExportDefaultDeclaration(path: any) {
        try {
          const { node } = path;
          const decl = node.declaration;

          if (!decl || decl.type !== "CallExpression") return;

          const { callee } = decl;

          let componentName: string;
          if (isAppRefCall(callee)) {
            componentName = "default";
          } else if (isComRefCall(callee) || isPopupRefCall(callee)) {
            componentName = fallbackName;
          } else {
            return;
          }

          const jsdoc = extractMybricksJSDocFromNode(node, null);

          if (jsdoc) {
            result.set(componentName, jsdoc);
          }
        } catch {
          // 忽略单节点解析错误
        }
      },
    },
  };
}
