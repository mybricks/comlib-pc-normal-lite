import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CaretRightOutlined } from '@ant-design/icons'
import { ColorPicker, Input, InputNumber, Select } from 'antd'
import { useDarkMode } from '../../../../../utils/hooks'
import css from './index.less'

export interface CssVariable {
  name: string
  title?: string
  value: string | number
  [key: string]: unknown
}

export interface CssVariableCategory {
  category: string
  variables: CssVariable[]
  [key: string]: unknown
}

export interface EnvStyle {
  id: string
  name: string
  cssVariables: CssVariableCategory[]
  [key: string]: unknown
}

export interface EnvConfig {
  style: {
    active: string
    styles: EnvStyle[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type EnvInput = EnvConfig | string | null | undefined

export interface EnvConfigAction {
  type: string
  title: string
}

export interface EnvConfigPanelProps {
  /** env.json 的对象或 JSON 字符串。 */
  env: EnvInput
  /** 配置变更时返回完整的 env 对象。 */
  onChange?: (env: EnvConfig) => void
  /** 配置变更时返回格式化后的 env.json 内容，便于直接写入文件系统。 */
  onSave?: (source: string, refElement: HTMLDivElement, action: EnvConfigAction) => void
  disabled?: boolean
  className?: string
}

const EMPTY_ENV: EnvConfig = {
  style: {
    active: '',
    styles: [],
  },
}

function isEnvConfig(value: unknown): value is EnvConfig {
  if (!value || typeof value !== 'object') return false
  const style = (value as { style?: unknown }).style
  if (!style || typeof style !== 'object') return false

  const styles = (style as { styles?: unknown }).styles
  return typeof (style as { active?: unknown }).active === 'string' &&
    Array.isArray(styles) &&
    styles.every(item => {
      if (!item || typeof item !== 'object') return false
      const itemStyle = item as Partial<EnvStyle>
      return typeof itemStyle.id === 'string' &&
        typeof itemStyle.name === 'string' &&
        Array.isArray(itemStyle.cssVariables) &&
        itemStyle.cssVariables.every(category =>
          Boolean(category) &&
          typeof category.category === 'string' &&
          Array.isArray(category.variables) &&
          category.variables.every(variable =>
            Boolean(variable) &&
            typeof variable.name === 'string' &&
            (typeof variable.value === 'string' || typeof variable.value === 'number'),
          ),
        )
    })
}

/** Parses plain JSON and URL-encoded file content used by the MyBricks file system. */
export function parseEnv(source: EnvInput): EnvConfig {
  if (isEnvConfig(source)) return source
  if (typeof source !== 'string' || !source.trim()) return EMPTY_ENV

  try {
    const parsed = JSON.parse(source)
    return isEnvConfig(parsed) ? parsed : EMPTY_ENV
  } catch {
    try {
      const parsed = JSON.parse(decodeURIComponent(source))
      return isEnvConfig(parsed) ? parsed : EMPTY_ENV
    } catch {
      return EMPTY_ENV
    }
  }
}

/** Serializes an env object in the format expected by config/env.json. */
export function serializeEnv(env: EnvConfig): string {
  return JSON.stringify(env, null, 2)
}

function isColorValue(value: string | number): value is string {
  return typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(value.trim())
}

export default function EnvConfigPanel({
  env,
  onChange,
  onSave,
  disabled = false,
  className,
}: EnvConfigPanelProps) {
  const parsedEnv = useMemo(() => parseEnv(env), [env])
  const panelRef = useRef<HTMLDivElement>(null)
  const [selectedStyleId, setSelectedStyleId] = useState(parsedEnv.style.active)
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  useEffect(() => {
    const styles = parsedEnv.style.styles
    setSelectedStyleId(parsedEnv.style.active || styles[0]?.id || '')
  }, [parsedEnv])

  const selectedStyle = parsedEnv.style.styles.find(style => style.id === selectedStyleId)

  const getCategoryKey = (styleId: string, categoryIndex: number) => `${styleId}:${categoryIndex}`

  const commit = (nextEnv: EnvConfig, action: EnvConfigAction) => {
    onChange?.(nextEnv)
    onSave?.(serializeEnv(nextEnv), panelRef.current!, action)
  }

  const updateStyle = (
    styleId: string,
    updater: (style: EnvStyle) => { style: EnvStyle, action: EnvConfigAction },
  ) => {
    let action: EnvConfigAction | undefined
    const styles = parsedEnv.style.styles.map(style => {
      if (style.id !== styleId) return style

      const result = updater(style)
      action = result.action
      return result.style
    })

    if (!action) return
    commit({
      ...parsedEnv,
      style: { ...parsedEnv.style, styles },
    }, action)
  }

  const updateVariable = (
    styleId: string,
    categoryIndex: number,
    variableIndex: number,
    updater: (variable: CssVariable) => CssVariable,
  ) => {
    updateStyle(styleId, style => {
      const variable = style.cssVariables[categoryIndex]?.variables[variableIndex]
      const variableTitle = variable?.title || variable?.name || 'CSS 变量'

      return {
        style: {
          ...style,
          cssVariables: style.cssVariables.map((category, currentCategoryIndex) =>
            currentCategoryIndex === categoryIndex
              ? {
                  ...category,
                  variables: category.variables.map((variable, currentVariableIndex) =>
                    currentVariableIndex === variableIndex ? updater(variable) : variable,
                  ),
                }
              : category,
          ),
        },
        action: {
          type: `env-variable:${styleId}:${variableTitle}`,
          title: `修改${style.name || styleId}主题的${variableTitle}`,
        },
      }
    })
  }

  const isDark = useDarkMode();

  const rootClassName = [css.panel, className].filter(Boolean).join(' ')

  return (
    <div
      ref={panelRef}
      className={css.container}
      data-zone-kind="config"
      style={{
        '--text': isDark ? '#f0f6fc' : '#1f2328',
      }}
    >
      {isPanelOpen && <div className={rootClassName} aria-label="环境主题配置" data-zone-type='ai-fixed'>
        <header className={css.header}>
          <div>
            <h3 className={css.title}>主题配置</h3>
          </div>
        </header>

        <div className={css.styleSelector}>
          <label className={css.field}>
            <Select
              className={css.themeSelect}
              popupClassName={css.themeSelectPopup}
              value={selectedStyleId}
              disabled={disabled || parsedEnv.style.styles.length === 0}
              aria-label="选择主题"
              options={parsedEnv.style.styles.map(style => ({
                value: style.id,
                label: `${style.name || style.id}`,
              }))}
              onChange={styleId => {
                setSelectedStyleId(styleId)
                const style = parsedEnv.style.styles.find(item => item.id === styleId)
                const styleName = style?.name || style?.id || styleId
                commit({ ...parsedEnv, style: { ...parsedEnv.style, active: styleId } }, {
                  type: `env-theme:${styleId}`,
                  title: `切换至${styleName}主题`,
                })
              }}
            />
          </label>
          {parsedEnv.style.styles.length === 0 && <span className={css.emptyStyles}>尚未创建主题</span>}
        </div>

        {selectedStyle && (
          <div className={css.variableList}>
            {selectedStyle.cssVariables.map((category, categoryIndex) => {
              const categoryKey = getCategoryKey(selectedStyle.id, categoryIndex)
              const isExpanded = !collapsedCategories[categoryKey]

              return (
                <div className={css.variableCategory} key={`${category.category}-${categoryIndex}`}>
                  <button
                    className={css.categoryHeader}
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setCollapsedCategories(categories => ({
                      ...categories,
                      [categoryKey]: isExpanded,
                    }))}
                  >
                    <span className={css.categoryTitle}>{category.category}</span>
                    <CaretRightOutlined className={`${css.categoryIcon} ${isExpanded ? css.categoryIconExpanded : ''}`} />
                  </button>
                  {isExpanded && category.variables.map((variable, variableIndex) => (
                    <div className={css.variableRow} key={`${variable.name}-${variableIndex}`}>
                      <div className={css.variableMeta}>
                        <span className={css.variableTitle}>{variable.title || variable.name}</span>
                        <code className={css.variableName}>{variable.name}</code>
                      </div>
                      <label className={css.variableField}>
                        {isColorValue(variable.value) ? (
                          <ColorPicker
                            className={css.colorEditor}
                            rootClassName={css.colorEditorTheme}
                            value={variable.value}
                            disabled={disabled}
                            showText
                            onChangeComplete={color => updateVariable(
                              selectedStyle.id,
                              categoryIndex,
                              variableIndex,
                              item => ({ ...item, value: color.toHexString() }),
                            )}
                          />
                        ) : typeof variable.value === 'number' ? (
                          <InputNumber
                            className={css.numberEditor}
                            value={variable.value}
                            disabled={disabled}
                            onChange={value => {
                              if (typeof value !== 'number') return
                              updateVariable(
                                selectedStyle.id,
                                categoryIndex,
                                variableIndex,
                                item => ({ ...item, value }),
                              )
                            }}
                          />
                        ) : (
                          <Input
                            value={variable.value}
                            disabled={disabled}
                            onChange={event => updateVariable(
                              selectedStyle.id,
                              categoryIndex,
                              variableIndex,
                              item => ({ ...item, value: event.target.value }),
                            )}
                          />
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              )
            })}
            {selectedStyle.cssVariables.length === 0 && <p className={css.emptyVariables}>此主题还没有 CSS 变量。</p>}
          </div>
        )}
      </div>}
      <button
        className={`${css.toggleButton} ${isPanelOpen ? css.toggleButtonActive : ''}`}
        type="button"
        data-zone-type="ai-fixed"
        aria-label={isPanelOpen ? '关闭主题配置' : '打开主题配置'}
        aria-pressed={isPanelOpen}
        title={isPanelOpen ? '关闭主题配置' : '打开主题配置'}
        onClick={() => setIsPanelOpen(open => !open)}
      >
        {envConfigIcon}
      </button>
    </div>
  )
}

const envConfigIcon = <svg viewBox="0 0 1024 1024" width="32" height="32" aria-hidden="true"><path d="M512 65C264.6 65 64 265.6 64 513.1a448.9 448.9 0 0 0 19.2 130.3c28.8 43.7 88.5 57.2 124.8 64.8 198 41 235 20 348.8 250.8C783.2 936.5 960 745.5 960 513.1 960 265.6 759.4 65 512 65z m278.1 701.3a375.3 375.3 0 0 1-193 113.2c-17.2-32.3-32.6-58.4-47.3-80.2-24.6-36.2-48.6-62.6-75.8-83.2s-54.6-33.6-90.4-44.4c-29.3-8.8-61.4-14.9-98.6-21.9-19.5-3.7-39.7-7.4-62.4-12.1-16.4-3.4-35.3-7.7-51.7-14.6-9.6-4.1-17.2-8.7-22.4-13.4a377.6 377.6 0 0 1-12.5-96.6 376 376 0 1 1 725.9 138.1 377.6 377.6 0 0 1-71.8 115.1zM512 208a48 48 0 1 0 48 48 48 48 0 0 0-48-48z m-181 75a48 48 0 1 0 0 96 48 48 0 1 0 0-96z m-75 181a48 48 0 1 0 48 48 48 48 0 0 0-48-48z m437 157a72 72 0 1 0 50.9 21.1A71.5 71.5 0 0 0 693 621z m75-157a48 48 0 1 0 48 48 48 48 0 0 0-48-48z m-75-85a48.1 48.1 0 1 0-33.9-14.1A47.9 47.9 0 0 0 693 379z" fill="currentColor"></path></svg>
