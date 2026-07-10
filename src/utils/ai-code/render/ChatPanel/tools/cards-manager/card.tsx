import React, { useRef, useMemo, useId } from "react";
import { Tooltip } from 'antd'
import { CardContext } from "../../../mybricks/hooks";
import { makePinKey } from '../../pin-card-utils'
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

// ─── PinCollectionIcon ───────────────────────────────────────────────────────

const pinCornerPath = "M8 0H38V30C37 28.5 34 28 28 28C26.5368 28 24.7167 28 22.8008 28C18.3198 28 16.0794 28 14.3681 27.1281C12.8628 26.3611 11.6389 25.1372 10.8719 23.6319C10 21.9206 10 19.6802 10 15.1992C10 13.2833 10 11.4632 10 10C10 4 9.5 1 8 0Z"
const pinStarPath = "M25.3931 12.0822L23.9995 8.35538L22.606 12.0822L18.631 12.2559L21.7448 14.7328L20.6816 18.567L23.9995 16.371L27.3175 18.5669L26.2543 14.7328L29.3681 12.2559L25.3931 12.0822ZM21.9012 11.112L17.7858 11.2918C17.139 11.3201 16.8739 12.1359 17.3806 12.539L20.6043 15.1034L19.5036 19.0729C19.3306 19.6968 20.0246 20.201 20.5645 19.8437L23.9995 17.5702L27.4346 19.8437C27.9745 20.201 28.6685 19.6968 28.4955 19.0729L27.3948 15.1034L30.6185 12.539C31.1252 12.1359 30.8601 11.3201 30.2133 11.2918L26.0979 11.112L24.6552 7.25366C24.4284 6.64722 23.5706 6.64722 23.3439 7.25366L21.9012 11.112Z"
const pinStarFilledPath = "M24.6552 7.25366L26.0979 11.112L30.2133 11.2918C30.8601 11.3201 31.1252 12.1359 30.6185 12.539L27.3948 15.1034L28.4955 19.0729C28.6685 19.6968 27.9745 20.201 27.4346 19.8437L23.9995 17.5702L20.5645 19.8437C20.0246 20.201 19.3306 19.6968 19.5036 19.0729L20.6043 15.1034L17.3806 12.539C16.8739 12.1359 17.139 11.3201 17.7858 11.2918L21.9012 11.112L23.3439 7.25366C23.5706 6.64722 24.4284 6.64722 24.6552 7.25366Z"

function PinCollectionIcon({ filled = false }: { filled?: boolean }) {
  const id = useId().replace(/:/g, '')
  const filterId = `${id}-pin-filter`
  const maskId = `${id}-pin-mask`

  return (
    <svg
      className={css.pinIcon}
      fill="none"
      viewBox="0 0 38 38"
      aria-hidden="true"
      focusable="false"
    >
      <g filter={`url(#${filterId})`}>
        <path className={css.pinCorner} d={pinCornerPath} />
      </g>
      <mask
        id={maskId}
        style={{ maskType: 'alpha' }}
        maskUnits="userSpaceOnUse"
        x="8"
        y="0"
        width="30"
        height="30"
      >
        <path d={pinCornerPath} fill="#fff" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path d="M-6.5 0.5V44.5H37.5" stroke="#000" strokeOpacity=".08" />
      </g>
      {filled ? (
        <path d={pinStarFilledPath} className={css.pinStar} />
      ) : (
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d={pinStarPath}
          className={css.pinStar}
        />
      )}
      <defs>
        <filter id={filterId} x="0" y="-4" width="46" height="46" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="4" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.06 0" />
          <feBlend in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feMorphology radius=".5" operator="dilate" in="SourceAlpha" result="effect2_dropShadow" />
          <feOffset />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.04 0" />
          <feBlend in2="effect1_dropShadow" result="effect2_dropShadow" />
          <feBlend in="SourceGraphic" in2="effect2_dropShadow" result="shape" />
        </filter>
      </defs>
    </svg>
  )
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
  /** 当前卡片对应的 pinKey，首页已关注列表使用 */
  pinKey?: string;
  /** 当前卡片是否已 pin */
  isPinned?: boolean;
  /** pin 回调，点击图钉时触发 */
  onPin?: (name: string, props: Record<string, any>) => void;
  /** unpin 回调，已 pin 时点击图钉触发 */
  onUnPin?: (pinKey: string) => void;
  /** AI agent 实例，透传给 CardContext 供 useCardAction 使用 */
  agent?: any;
  /** 是否仅在 hover 时显示 pin 按钮（首页用），默认 false（聊天记录中始终显示） */
  showPinOnHover?: boolean;
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
  pinKey,
  isPinned = false,
  onPin,
  onUnPin,
  agent,
  showPinOnHover = false,
}: CardRenderProps) {
  // ── Hooks 必须在最顶部，不能在条件之后 ──────────────────────────────────
  const card = useMemo(
    () => groups.flatMap((g) => g.cards).find((c) => c.name === name),
    [groups, name],
  );
  const cardIdRef = useRef(cardId)

  cardIdRef.current = cardId

  const cardValueRef = useRef<{
    agent: any
    register: (slotKey: string, apis: any) => void
    unregister: (slotKey: string) => void
  }>({
    agent,
    register: (slotKey: string, apis: any) => {
      cardClass.register(cardIdRef.current, slotKey, apis)
    },
    unregister: (slotKey: string) => {
      cardClass.unregister(cardIdRef.current, slotKey)
    }
  })

  // 每次 render 时同步最新的 agent，确保 useCardAction 拿到最新引用
  cardValueRef.current.agent = agent

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
      onUnPin?.(pinKey ?? makePinKey(name, props))
    } else {
      onPin?.(name, props)
    }
  }

  // ── 正常渲染 ──────────────────────────────────────────────────────────────
  const Render = card.render;
  const hasPinCallback = !!(onPin || onUnPin)

  return (
    <div className={css.wrapper}>
      <div
        className={[
          css.cardWrapper,
          showPinOnHover && hasPinCallback ? css.cardWrapperHoverPin : '',
        ]
          .join(' ')
          .trim()}
        data-card-name={card.name}
      >
        {hasPinCallback && (
          <Tooltip title={isPinned ? '取消收藏' : '收藏'}>
            <button
              type="button"
              className={[css.pinBtn, isPinned ? css.pinBtnActive : ''].join(' ').trim()}
              aria-label={isPinned ? '取消收藏' : '收藏'}
              onClick={handlePinClick}
            >
              <PinCollectionIcon filled={isPinned} />
            </button>
          </Tooltip>
        )}
        <div className={css.cardContentLayer}>
          <CardContext.Provider value={cardValueRef.current}>
            <Render {...props}/>
          </CardContext.Provider>
        </div>
      </div>
    </div>
  );
}
