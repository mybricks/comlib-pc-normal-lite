import React from "react";
import { CardRender } from './card'
import { randomUUID } from '../../../../../../mix/utils/uuid'
import type { CardGroup } from "./types";

type Tool = any
type ToolResult = any

// ─── 工具名称常量 ──────────────────────────────────────────────────────────────

export const SHOW_CARD_TOOL_NAME = "show_ui_card";

// ─── Pin 回调接口 ─────────────────────────────────────────────────────────────

interface PinCallbacks {
  onPin: (name: string, props: Record<string, any>) => void
  onUnPin: (pinKey: string) => void
  isPinned: (name: string, props: Record<string, any>) => boolean
}

// ─── createShowCardTool ────────────────────────────────────────────────────────

/**
 * 创建 `show_ui_card` 工具。
 *
 * LLM 通过此工具触发 UI 层渲染指定卡片。
 * execute 本身只做参数校验并返回渲染状态，实际渲染由 UI 层
 * 监听 tool call 后通过 `CardRender` 组件完成。
 *
 * @param groups    卡片分组列表（在调用方构造后传入）
 * @param pinCbs    pin 能力回调（可选），不传则卡片不显示图钉按钮
 */
export function createShowCardTool(groups: CardGroup[], pinCbs?: PinCallbacks): Tool {
  const allCards = groups.flatMap((g) => g.cards);
  const cardNames = allCards.map((c) => c.name);

  return {
    name: SHOW_CARD_TOOL_NAME,
    title: "展示 UI 卡片",
    description: `根据 name 渲染对应的 UI 卡片，并将 props 数据传递给卡片。
调用时请从 available_cards 中选择合适的卡片 name，并根据卡片的 props 结构传入对应数据。`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: cardNames,
          description: "要渲染的卡片唯一 key（来自 available_cards）",
        },
        props: {
          type: "object",
          description: "传递给卡片的数据，结构参考 available_cards 中该卡片的 props 描述",
        },
      },
      required: ["name"],
    },
    validate(params: { name?: string; props?: Record<string, any> }) {
      if (!params.name || typeof params.name !== "string" || !params.name.trim()) {
        throw new Error("name is required and must be a non-empty string");
      }
      if (!cardNames.includes(params.name)) {
        throw new Error(
          `Card not found: "${params.name}". Available cards: ${cardNames.join(", ")}`,
        );
      }
    },
    async execute(params: { name: string; props?: Record<string, any> }): Promise<ToolResult> {
      const card = allCards.find((c) => c.name === params.name);
      if (!card) {
        return {
          output: `Error: Card "${params.name}" not found.`,
          metadata: { success: false, name: params.name },
        };
      }

      // 构建 apis 说明文字：将卡片声明的 apis 列表格式化给 LLM
      const apisDesc = card.apis && card.apis.length > 0
        ? card.apis.map((api) => `  - ${api.name}: ${api.description}`).join('\n')
        : '  （该卡片未声明任何 API）'

      const id = randomUUID()

      return {
        output: `UI 卡片 "${card.title}" 已渲染。
cardId: ${id}
可通过 call_ui_card_api 调用以下查询类 API 获取卡片数据（仅用于查询，不触发任何操作）：
${apisDesc}
注意：当用户要求重新执行某个动作（如"再试一次"、"重新查询"等），应重新调用 show_ui_card 渲染新卡片，而非调用 call_ui_card_api。`,
        metadata: {
          id,
          success: true,
          name: params.name,
          props: params.props ?? {},
        },
      };
    },
    render: (tool) => {
      const loading = tool?.status === 'pending';
      const cardId = tool?.result?.metadata?.id;
      const toolName = tool?.args?.name ?? '';
      const toolProps = tool?.args?.props ?? {};

      return (
        <CardRender
          groups={groups}
          name={toolName}
          props={toolProps}
          loading={loading}
          cardId={cardId}
          isPinned={pinCbs?.isPinned(toolName, toolProps) ?? false}
          onPin={pinCbs ? (n, p) => pinCbs.onPin(n, p) : undefined}
          onUnPin={pinCbs?.onUnPin}
        />
      )
    }
  };
}

// ─── buildAvailableCardsSection ───────────────────────────────────────────────

/**
 * 构建 available_cards 提示词片段。
 *
 * 将 CardGroup[] 格式化为类似 available_skills 的结构化文本，
 * 注入到 system prompt 中，告知 LLM 当前可用的卡片及其用途。
 *
 * 输出格式示例：
 * ```
 * <available_cards>
 * <card_group title="team" description="team management">
 *   <card name="member-list" title="成员列表" description="展示团队成员信息">
 *     props: { "teamId": "string" }
 *   </card>
 * </card_group>
 * </available_cards>
 * ```
 *
 * @param groups  卡片分组列表
 */
export function buildAvailableCardsSection(groups: CardGroup[]): string {
  if (!groups.length) return "";

  const groupBlocks = groups.map((group) => {
    const cardLines = group.cards.map((card) => {
      const propsStr =
        card.props && card.props.properties && Object.keys(card.props.properties).length > 0
          ? `\n  - props: ${JSON.stringify(card.props)}`
          : "";

      // const apisStr =
      //   card.apis && card.apis.length > 0
      //     ? `\n  - apis:\n${card.apis.map((api) => `    - ${api.name}: ${api.description}`).join("\n")}`
      //     : "";

      return `- name: \`${card.name}\`  title: ${card.title}  desc: ${card.description}${propsStr}`;
    });

    return group.md + `\n\n# 可用卡片如下:\n` + cardLines.join("\n");
  });

  return `<available_cards>\n当前可用的卡片分组如下，每一个分组下都有分组相关的卡片，你可以通过提供各类卡片来和用户完成交互。\n\n${groupBlocks.join("\n\n---\n\n")}\n</available_cards>`;
}
