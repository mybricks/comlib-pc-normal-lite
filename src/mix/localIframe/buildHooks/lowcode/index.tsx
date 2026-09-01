import React, { useState } from 'react'
import context from '../../../context'
import lowcodeViewCss from './index.lazy.less'
import * as lowcodeViewCssNS from './index.lazy.less'

type TabKey = 'task' | 'version'
const css = (lowcodeViewCss as any).locals || lowcodeViewCss

function LowcodeViewShell() {
  const [activeTab, setActiveTab] = useState<TabKey>('task')

  return (
    <div className={css['lowcode-view-container']}>
      <div className={css['lowcode-view-toolbar']}>
        <div className={css['lowcode-view-toolbar-tabs']}>
          <div className={css['lowcode-view-toolbar-left']}>
            <div
              className={`${css['lowcode-view-toolbar-tab']} ${activeTab === 'task' ? css['lowcode-view-toolbar-tab-active'] : ''}`}
              onClick={() => setActiveTab('task')}
            >
              任务
            </div>
            <div
              className={`${css['lowcode-view-toolbar-tab']} ${activeTab === 'version' ? css['lowcode-view-toolbar-tab-active'] : ''}`}
              onClick={() => setActiveTab('version')}
            >
              版本
            </div>
          </div>
        </div>
      </div>
      <div className={css['lowcode-view']}>
        {activeTab === 'task' ? <div>任务</div> : <div>版本</div>}
      </div>
    </div>
  )
}

export default {
  render(params: any, plugins: any) {
    context.plugins = plugins;
    const showAIDialog = plugins.showAIDialog;
    (window as any)._showAIDialog_ = showAIDialog;
    return <LowcodeViewShell />;
  },
  useCSS() {
    function transform(ns) {
      if (ns.default?.locals) {
        return ns.default.locals
      } else {
        return ns
      }
    }

    const genUse = (css) => {
      return css
    }

    return [
      {
        css: transform(lowcodeViewCssNS),
        use: genUse(lowcodeViewCss)
      },
    ]
  },
}