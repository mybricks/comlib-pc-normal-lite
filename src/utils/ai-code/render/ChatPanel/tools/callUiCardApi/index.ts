import React from "react";
import cardClass from '../card'

type Tool = any
type ToolResult = any

// ─── 工具名称常量 ──────────────────────────────────────────────────────────────

export const CALL_CARD_API_TOOL_NAME = "call_ui_card_api";

// ─── createCallCardApiTool ────────────────────────────────────────────────────

/**
 * 创建 `call_ui_card_api` 工具。
 *
 * LLM 通过此工具调用已渲染卡片对外暴露的 API，获取卡片内部数据。
 *
 * 工作流程：
 * 1. LLM 先通过 `show_ui_card` 渲染卡片，从工具返回的 output 中获得 `cardId` 和可用 API 列表；
 * 2. 卡片组件挂载后，通过 `useCardApis` hook 将 API 函数注册到全局注册表；
 * 3. LLM 调用本工具，`execute` 从注册表中找到对应卡片，批量调用指定 API 并返回结果。
 */
export function createCallCardApiTool(): Tool {

  return {
    name: CALL_CARD_API_TOOL_NAME,
    title: "查询 UI 卡片数据",
    description: `调用指定 cardId 的 UI 卡片所暴露的 API，获取卡片内部状态或数据。
使用前请先通过 show_ui_card 渲染对应卡片，并从返回信息中获取 cardId 与可用的 API 名称列表。
注意：此工具仅适用于查询数据，不应用于触发操作或副作用，当用户要求重新执行某个动作（如“再试一次”、“重新查询”等），应重新调用 show_ui_card 渲染新卡片`,
    parameters: {
      type: "object",
      properties: {
        cardId: {
          type: "string",
          description: "目标 UI 卡片的唯一实例 id，从 show_ui_card 的返回信息中获取",
        },
        apiNames: {
          type: "array",
          items: { type: "string" },
          description: "要调用的 API 名称列表，从 show_ui_card 返回的可用 API 中选取",
        },
      },
      required: ["cardId", "apiNames"],
    },
    validate(params: { cardId?: string; apiNames?: string[] }) {
      console.log(`[${CALL_CARD_API_TOOL_NAME}:validate]`, params)
      if (!params.cardId || typeof params.cardId !== "string" || !params.cardId.trim()) {
        throw new Error("cardId is required and must be a non-empty string");
      }
      if (!Array.isArray(params.apiNames) || params.apiNames.length === 0) {
        throw new Error("apiNames must be a non-empty array of strings");
      }
    },
    async execute(params: { cardId: string; apiNames: string[] }): Promise<ToolResult> {
      console.log(`[${CALL_CARD_API_TOOL_NAME}:execute]`, params)

      const results = cardClass.callApis(params.cardId, params.apiNames)

      // 将结果格式化为可读文本返回给 LLM
      const hasError = '_error' in results
      if (hasError) {
        return {
          output: `调用失败：${results._error}`,
          metadata: { success: false, cardId: params.cardId, results },
        }
      }

      const lines = Object.entries(results).map(
        ([api, value]) => `  - ${api}: ${JSON.stringify(value)}`
      )
      return {
        output: `卡片 API 调用结果（cardId: ${params.cardId}）：\n${lines.join('\n')}`,
        metadata: { success: true, cardId: params.cardId, results },
      }
    },
  };
}
