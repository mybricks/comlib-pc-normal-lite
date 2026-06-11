import React, { useMemo } from "react";
import type { CardGroup } from "./types";

// ─── CardRender ─────────────────────────────────────────────────────────────────

export interface CardRenderProps {
  /** 所有卡片分组（与 createShowCardTool 传入的 groups 一致） */
  groups: CardGroup[];
  /** LLM 调用 show_ui_card 传入的 name */
  name: string;
  /** LLM 调用 show_ui_card 传入的 props */
  props?: Record<string, any>;
}

/**
 * CardRender — 核心渲染容器。
 *
 * 根据 `name` 从 groups 中找到对应的 CardDef，
 * 调用其 `render` 函数并将结果渲染在一个 div 容器中。
 *
 * 用法：
 * ```tsx
 * <CardRender groups={myGroups} name={toolCall.args.name} props={toolCall.args.props} />
 * ```
 */
export function CardRender({ groups, name, props = {} }: CardRenderProps) {
  const card = useMemo(
    () => groups.flatMap((g) => g.cards).find((c) => c.name === name),
    [groups, name],
  );

  if (!card) {
    return (
      <div style={{ padding: "8px 12px", color: "#999", fontSize: 12 }}>
        未找到卡片：{name}
      </div>
    );
  }

  return (
    <div data-card-name={card.name}>
      {card.render(props as any)}
    </div>
  );
}
