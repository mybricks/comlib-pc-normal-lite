// ─── 类型定义 ──────────────────────────────────────────────────────────────────
/**
 * 卡片对外暴露的单个 API 定义（对应 index.config.ts 中的 apis 数组元素）。
 */
export interface CardApiDef {
  /** API 名称，与卡片 useCardApis 注册的 key 保持一致 */
  name: string;
  /** API 用途描述，注入 available_cards 提示词供 LLM 理解 */
  description: string;
}

/**
 * 单张卡片定义。
 *
 * - `name`        唯一 key，LLM 通过此字段指定要渲染哪张卡片
 * - `title`       展示标题，用于提示词构建
 * - `description` 一句话描述，注入 available_cards 提示词
 * - `props`       默认 props（类型由调用方通过泛型约束）
 * - `apis`        卡片对外暴露的 API 列表，LLM 可通过 call_ui_card_api 调用
 * - `render`      UI 层渲染函数（仅在 plugin 层使用，agent 层无感知）
 */
export interface CardDef<TProps extends Record<string, any> = Record<string, any>> {
  /** 唯一 key，LLM 调用 show_ui_card 工具时传入 */
  name: string;
  /** 展示标题，用于 available_cards 提示词 */
  title: string;
  /** 一句话描述，说明此卡片的用途 */
  description: string;
  /** 该卡片接受的 props 结构（作为示例/文档用途） */
  props?: TProps;
  /**
   * 卡片对外暴露的 API 列表。
   * LLM 可在卡片渲染后通过 `call_ui_card_api` 工具按 name 调用，获取卡片内部数据。
   * 对应 index.config.ts 中的 apis 字段，以及组件内 useCardApis 注册的函数 key。
   */
  apis?: CardApiDef[];
  /** 渲染函数，接收 props 返回 React 节点 */
  render: (props: TProps) => React.ReactNode;
}

/**
 * 卡片分组。
 *
 * 将多张 CardDef 按维度分组，对应提示词中的一个 group block。
 */
export interface CardGroup {
  /** 分组标题（英文 key，如 "team"、"project"） */
  title: string;
  /** 分组用途描述，注入提示词 */
  description: string;
  /** 该分组下的卡片列表 */
  cards: CardDef[];
  /** SKILL.md */
  md: string;
}