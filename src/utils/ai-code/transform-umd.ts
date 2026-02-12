import React from 'react'
import babelPlugin from './plugins/babelPlugin'

/** 本模块依赖 CDN 注入的全局变量 */
const win = window as Window & { less?: any; Babel?: any }

export function getComponentFromJSX(jsxCode, libs: { mybricksSdk }, dependencies = {}): Promise<Function> {
  return new Promise((resolve, reject) => {
    transformTsx(jsxCode).then(code => {
      try {
        const rtn: any = runRender(code, {
            'react': React,
            '@ant-design/icons': window['icons'],
            'dayjs': window['dayjs'] ?? window['moment'],
            'mybricks': libs.mybricksSdk,
            ...dependencies,
          }
        )
        resolve(rtn)
      } catch (ex) {
        reject(ex)
        return
      }
    }).catch(ex => {
      reject(ex)
    })
  })
}

export function transformTsx(code): Promise<{ transformCode: string, constituency: any }> {
  const constituency: any = []
  const options = {
    presets: [
      [
        "env",
        {
          "modules": "commonjs"//umd->commonjs
        }
      ],
      'react'
    ],
    plugins: [
      ['proposal-decorators', {legacy: true}],
      'proposal-class-properties',
      [
        'transform-typescript',
        {
          isTSX: true
        }
      ],
      babelPlugin({ constituency })
    ]
  }

  return ensureBabelReady()
    .then(() => {
      if (!win.Babel) {
        throw new Error('当前环境 Babel 编译器 未准备好')
      }
      const transformCode = win.Babel.transform(code, options).code
      return { transformCode, constituency }
    })
    .catch((error) => {
      console.error("[@transformTsx error]", error)
      throw error
    })
}

export function transformLess(code: string): Promise<string> {
  if (!code || code.length === 0) {
    return Promise.resolve('')
  }

  return ensureLessReady()
    .then(() => {
      if (!win.less) {
        throw new Error('当前环境无 Less 编译器，请联系应用负责人')
      }
      return new Promise<string>((resolve, reject) => {
        win.less.render(code, {}, (error, result) => {
          if (error) {
            console.error(error)
            reject(new Error(`Less 代码编译失败: ${error.message}`))
          } else {
            resolve(result?.css ?? '')
          }
        })
      })
    })
    .catch((error) => {
      console.error("[@transformLess error]", error)
      throw error
    })
}

export function updateRender({data}, renderCode) {
  transformTsx(renderCode.replace(/import css from ['"][^'"]*style.less['"]/, 'const css = new Proxy({}, { get(target, key) { return key } })')).then(({ transformCode, constituency }) => {
    data.runtimeJsxCompiled = encodeURIComponent(transformCode)
    data.runtimeJsxSource = encodeURIComponent(renderCode)
    data.runtimeJsxConstituency = constituency
    data._jsxErr = ''
  }).catch(e => {
    console.error("[@transformTsx error]", e);
    data._jsxErr = e?.message ?? '未知错误'
  })
}

export function updateStyle({id, data}, styleCode) {
  transformLess(`.__mybricks_ai_module_id__ {${styleCode}}`).then(css => {
    data.styleCompiled = encodeURIComponent(css)
    data.styleSource = encodeURIComponent(styleCode)
    data._cssErr = '';
  }).catch(e => {
    console.error("[@transformLess error]", e);
    data._cssErr = e?.message ?? '未知错误'
  })
}


async function requireFromCdn(cdnUrl) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = cdnUrl
    document.body.appendChild(el)
    el.onload = () => {
      resolve(true)
    }
    el.onerror = () => {
      reject(new Error(`加载${cdnUrl}失败`))
    }
  })
}

let lessLoadPromise: Promise<void> | null = null
/** 确保 window.less 已加载，未加载则拉取 CDN 并等待完成 */
async function ensureLessReady(): Promise<void> {
  if (win.less) return
  if (!lessLoadPromise) {
    lessLoadPromise = requireFromCdn('https://f2.beckwai.com/udata/pkg/eshop/fangzhou/asset/less/4.2.0/less.js').then(() => {
      if (!win.less) throw new Error('Less 脚本已加载但 window.less 未就绪')
    })
  }
  await lessLoadPromise
}
ensureLessReady()

let babelLoadPromise: Promise<void> | null = null
/** 确保 window.Babel 已加载，未加载则拉取 CDN 并等待完成 */
async function ensureBabelReady(): Promise<void> {
  if (win.Babel) return
  if (!babelLoadPromise) {
    babelLoadPromise = requireFromCdn('https://f2.beckwai.com/udata/pkg/eshop/fangzhou/asset/babel/standalone/7.24.7/babel.min.js').then(() => {
      if (!win.Babel) throw new Error('Babel 脚本已加载但 window.Babel 未就绪')
    })
  }
  await babelLoadPromise
}
ensureBabelReady()


function runRender(code, dependencies) {
  const wrapCode = `
          (function(exports,require){
            ${code}
          })
        `

  const exports = {
    default: null
  }

  const require = (packageName) => {
    return dependencies[packageName]
  }

  eval(wrapCode)(exports, require)

  return exports.default
}

export function uuid(pre = 'u_', len = 6) {
  const seed = 'abcdefhijkmnprstwxyz0123456789', maxPos = seed.length;
  let rtn = '';
  for (let i = 0; i < len; i++) {
    rtn += seed.charAt(Math.floor(Math.random() * maxPos));
  }
  return pre + rtn;
}