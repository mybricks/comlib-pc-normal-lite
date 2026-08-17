import React, {
  useRef,
  useContext,
  createContext,
  useEffect
} from 'react'
import type { ToolParams } from './type'
import canvasClass from '../canvas'
import css from './CanvasRender.less'

const CanvasContext = createContext<{
  id: string | null
  agent: any
}>({
  id: null,
  agent: null
})

const ComponentContext = createContext<{
  id: string | null
  set: (params: any) => void
}>({
  id: null,
  set: () => {}
})

/**
 * LoadingCard — 骨架屏 loading 状态。
 */
function LoadingCard() {
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

export const useExposeApi = (apis) => {
  const { set } = useContext(ComponentContext)

  if (!set) return

  set({ apis })
}

type CardAction =
  | {
      type: 'appendToAgentInput'
      /** 追加到 IDE AI 对话输入框的文本，用户确认后发送 */
      text: string
    }
  | {
      type: 'openExternal'
      /** 通过 IDE 宿主在系统浏览器中打开的绝对 URL（http:// 或 https://） */
      url: string
    }
  | {
      type: 'sendUserMessage'
      /** 直接以用户身份发送消息到 AI 对话，无需用户手动确认 */
      text: string
    }

export const useCanvasAction = () => {
  const { agent } = useContext(CanvasContext)

  if (!agent) {
    return () => {}
  }

  const dispatch = (params: CardAction) => {
    if (!agent) {
      console.log('[useCanvasAction:dispatch]', 'agent is not found, please check if the component is wrapped by CardRenderer')
      return
    }

    if (params.type === 'sendUserMessage') {
      agent.requestAI?.({ message: params.text })
    } else {
      console.log('[useCanvasAction:dispatch]', 'not support card action type: ', params.type)
    }
  }

  return dispatch
}

interface RenderComponentProps {
  componentId: string
  components: Record<string, {
    render: React.FC<any>
  }>
  componentsDSL: Map<string, ToolParams['components'][number]>
}
const RenderComponent = (props: RenderComponentProps) => {
  const { componentId, components, componentsDSL } = props
  const node = componentsDSL.get(componentId)!
  const { children, ...other } = node.props ?? {}
  const Component = components[node.component].render
  const { id: canvasId } = useContext(CanvasContext)
  const componentValueRef = useRef({
    id: componentId,
    set(value) {
      const canvas = canvasClass.canvasMap.get(canvasId!)
      if (!canvas) {
        return
      }

      const component = canvas!.get(componentId)!
      if (!component) {
        return
      }

      Object.entries(value).forEach(([key, value]) => {
        component[key] = value
      })
    }
  })

  if (!canvasClass.canvasMap.get(canvasId!)!.has(componentId)) {
    canvasClass.canvasMap.get(canvasId!)!.set(componentId, {
      apis: {}
    })
  }

  return (
    <ComponentContext.Provider value={componentValueRef.current}>
      <Component {...other}>
        {Array.isArray(children)
          ? children.map((childId) => <RenderComponent key={childId} componentId={childId} components={components} componentsDSL={componentsDSL}/>)
          : undefined}
      </Component>
    </ComponentContext.Provider>
  )
}

interface BuildInContainerProps {
  gap: number
  direction: 'column' | 'row',
  children: React.ReactNode[]
}
const BuildInContainer = (props: BuildInContainerProps) => {
  const { gap = 0, direction = 'column', children } = props
  return (
    <div
      style={{ display: 'flex', flexDirection: direction, gap }}
    >
      {children}
    </div>
  )
}

interface CanvasRenderProps {
  agent: any
  loading: boolean
  canvasId: string
  params: ToolParams
  components: Record<string, {
    render: React.FC<any>
  }>
}
const CanvasRender = (props: CanvasRenderProps) => {
  const {
    agent,
    loading,
    canvasId,
    params,
    components
  } = props

  const canvasValueRef = useRef({
    id: canvasId,
    agent: null,
  })

  canvasValueRef.current.id = canvasId
  canvasValueRef.current.agent = agent

  useEffect(() => {
    return () => {
      // canvasClass.canvasMap.delete(canvasValueRef.current.id)
    }
  }, [])

  // ── Loading 状态 ──────────────────────────────────────────────────────────
  if (loading) {
    return <LoadingCard />;
  }

  if (canvasId && !canvasClass.canvasMap.has(canvasId)) {
    canvasClass.canvasMap.set(canvasId, new Map())
  }

  return (
    <div className={css.wrapper}>
      <div
        className={[
          css.cardWrapper,
          // showPinOnHover && hasPinCallback ? css.cardWrapperHoverPin : '',
        ]
          .join(' ')
          .trim()}
      >
        {/* {hasPinCallback && (
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
        )} */}
        <div className={css.cardContentLayer}>
          <CanvasContext.Provider value={canvasValueRef.current}>
            <RenderComponent
              components={components}
              componentsDSL={new Map(params.components.map((component) => [component.id, component]))}
              componentId={'root'}
            />
          </CanvasContext.Provider>
        </div>
      </div>
    </div>
  );
}

export { BuildInContainer }

export default CanvasRender
