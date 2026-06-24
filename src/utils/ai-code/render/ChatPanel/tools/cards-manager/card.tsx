import React, { useRef, useMemo } from "react";
import { PushpinFilled, PushpinOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { CardContext } from "../../../mybricks/hooks";
import cardClass from '../card';
import type { CardGroup } from "./types";
import css from "./card.less";

// ─── LoadingCard ─────────────────────────────────────────────────────────────

/**
 * LoadingCard — 骨架屏 loading 状态。
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
  /** 当前卡片是否已 pin */
  isPinned?: boolean;
  /** pin 回调，点击图钉时触发 */
  onPin?: (name: string, props: Record<string, any>) => void;
  /** unpin 回调，已 pin 时点击图钉触发 */
  onUnPin?: (pinKey: string) => void;
}

/**
 * CardRender — 核心渲染容器。
 *
 * 三种状态：
 * 1. `loading=true`  → 骨架屏 LoadingCard
 * 2. 找不到对应 card → NotFoundCard 兜底
 * 3. 正常            → 渲染对应卡片，右上角叠加图钉 pin 按钮
 */
export function CardRender({
  groups,
  name,
  props = {},
  loading = false,
  cardId,
  isPinned = false,
  onPin,
  onUnPin,
}: CardRenderProps) {
  // ── Hooks 必须在最顶部，不能在条件之后 ──────────────────────────────────
  const card = useMemo(
    () => groups.flatMap((g) => g.cards).find((c) => c.name === name),
    [groups, name],
  );
  const cardIdRef = useRef(cardId)

  cardIdRef.current = cardId

  const cardValueRef = useRef({
    register: (apis) => {
      cardClass.register(cardIdRef.current, apis)
    },
    unregister: () => {
      cardClass.unregister(cardIdRef.current)
    }
  })

  // ── Loading 状态 ──────────────────────────────────────────────────────────
  if (loading) {
    return <LoadingCard />;
  }

  // ── 未找到兜底 ────────────────────────────────────────────────────────────
  if (!card) {
    return <NotFoundCard name={name} />;
  }

  // ── Pin 按钮点击处理 ──────────────────────────────────────────────────────
  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isPinned) {
      // pinKey = name::JSON.stringify(props)
      onUnPin?.(`${name}::${JSON.stringify(props)}`)
    } else {
      onPin?.(name, props)
    }
  }

  // ── 正常渲染 ──────────────────────────────────────────────────────────────
  const Render = card.render;
  const hasPinCallback = !!(onPin || onUnPin)

  return (
    <div className={css.wrapper}>
      <div className={css.cardWrapper} data-card-name={card.name}>
        {hasPinCallback && (
          <Tooltip title={isPinned ? '取消关注' : '关注此卡片'}>
            <button
              type="button"
              className={[css.pinBtn, isPinned ? css.pinBtnActive : ''].join(' ').trim()}
              aria-label={isPinned ? '取消关注' : '关注此卡片'}
              onClick={handlePinClick}
            >
              {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
            </button>
          </Tooltip>
        )}
        <CardContext.Provider value={cardValueRef.current}>
          <Render {...props}/>
        </CardContext.Provider>
      </div>
    </div>
  );
}
