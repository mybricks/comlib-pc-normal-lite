import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ColorPicker, Input, InputNumber, Select } from 'antd'
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

  useEffect(() => {
    const styles = parsedEnv.style.styles
    setSelectedStyleId(parsedEnv.style.active || styles[0]?.id || '')
  }, [parsedEnv])

  const selectedStyle = parsedEnv.style.styles.find(style => style.id === selectedStyleId)

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

  const rootClassName = [css.panel, className].filter(Boolean).join(' ')

  return (
    <div ref={panelRef} data-zone-kind="config" style={{ width: 480, maxHeight: '100vh' }}>
      <div className={rootClassName} aria-label="环境主题配置" data-zone-type='ai-fixed'>
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
            {selectedStyle.cssVariables.map((category, categoryIndex) => (
              <div className={css.variableCategory} key={`${category.category}-${categoryIndex}`}>
                <div className={css.categoryHeader}>
                  <h5 className={css.categoryTitle}>{category.category}</h5>
                </div>
                {category.variables.map((variable, variableIndex) => (
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
            ))}
            {selectedStyle.cssVariables.length === 0 && <p className={css.emptyVariables}>此主题还没有 CSS 变量。</p>}
          </div>
        )}
      </div>
    </div>
  )
}
