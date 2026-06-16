import React, { useRef, useMemo } from "react";
import { CardContext } from "../../../mybricks/hooks";
import cardClass from '../card';
import type { CardGroup } from "./types";
import css from "./card.less";

// ─── LoadingCard ─────────────────────────────────────────────────────────────

/**
 * LoadingCard — 骨架屏 loading 状态。
 *
 * 用法：
 * ```tsx
 * <LoadingCard />
 * ```
 */
export function LoadingCard() {
  return (
    <div className={css.wrapper}>
      <div className={css.loadingCard}>
        {/* 头部：头像 + 标题行 */}
        <div className={css.header}>
          <div className={css.avatar} />
          <div className={css.titleBlock}>
            <div className={css.skeletonLine} style={{ width: "60%", height: 14 }} />
            <div className={css.skeletonLine} style={{ width: "40%", height: 10 }} />
          </div>
        </div>
        {/* 内容行 */}
        <div className={css.lines}>
          <div className={css.skeletonLine} style={{ width: "100%" }} />
          <div className={css.skeletonLine} style={{ width: "90%" }} />
          <div className={css.skeletonLine} style={{ width: "75%" }} />
        </div>
        {/* 底部操作区 */}
        <div className={css.actions}>
          <div className={css.skeletonBtn} />
          <div className={css.skeletonBtn} />
        </div>
      </div>
    </div>
  );
}

// ─── NotFoundCard ─────────────────────────────────────────────────────────────

/**
 * NotFoundCard — 未找到卡片时的兜底展示。
 *
 * 用法：
 * ```tsx
 * <NotFoundCard name="some-card" />
 * ```
 */
export function NotFoundCard({ name }: { name?: string }) {
  return (
    <div className={css.wrapper}>
      <div className={css.notFoundCard}>
        <span className={css.icon}>⚠️</span>
        <div>
          <div className={css.title}>卡片未找到</div>
          <div className={css.desc}>
            {name ? (
              <>
                未注册的卡片：<code>{name}</code>
              </>
            ) : (
              "未指定卡片名称，请检查配置。"
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CardRender ──────────────────────────────────────────────────────────────

export interface CardRenderProps {
  /** 所有卡片分组（与 createShowCardTool 传入的 groups 一致） */
  groups: CardGroup[];
  /** LLM 调用 show_ui_card 传入的 name */
  name: string;
  /** LLM 调用 show_ui_card 传入的 props */
  props?: Record<string, any>;
  /** 是否处于 loading 状态，显示骨架屏 */
  loading?: boolean;
  /** 卡片实例，唯一ID */
  cardId: string;
}

/**
 * CardRender — 核心渲染容器。
 *
 * 三种状态：
 * 1. `loading=true`  → 骨架屏 LoadingCard
 * 2. 找不到对应 card → NotFoundCard 兜底
 * 3. 正常            → 渲染对应卡片，包裹在统一宽度容器中
 *
 * 用法：
 * ```tsx
 * <CardRender groups={myGroups} name={toolCall.args.name} props={toolCall.args.props} />
 * <CardRender groups={myGroups} name="unknown" />         // 兜底
 * <CardRender groups={myGroups} name="xxx" loading />     // 骨架屏
 * ```
 */
export function CardRender({ groups, name, props = {}, loading = false, cardId }: CardRenderProps) {
  // ── Hooks 必须在最顶部，不能在条件之后 ──────────────────────────────────
  const card = useMemo(
    () => groups.flatMap((g) => g.cards).find((c) => c.name === name),
    [groups, name],
  );

  const cardValueRef = useRef({
    register: (apis) => {
      cardClass.register(cardId, apis)
    },
    unregister: () => {
      cardClass.unregister(cardId)
    }
  })

  // ── Loading 状态 ──────────────────────────────────────────────────────────
  if (loading) {
    return <LoadingCard />;
  }

  console.log('[groups]', groups)
  console.log('props', {
    name,
    props,
    loading,
    cardId
  })

  // ── 未找到兜底 ────────────────────────────────────────────────────────────
  if (!card) {
    return <NotFoundCard name={name} />;
  }

  // ── 正常渲染 ──────────────────────────────────────────────────────────────
  const Render = card.render;

  return (
    <div className={css.wrapper}>
      <div className={css.cardWrapper} data-card-name={card.name}>
        <CardContext.Provider value={cardValueRef.current}>
          <Render {...props}/>
        </CardContext.Provider>
      </div>
    </div>
  );
}
