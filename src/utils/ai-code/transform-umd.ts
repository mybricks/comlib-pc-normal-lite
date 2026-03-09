import React from 'react'
import babelPlugin from './plugins/babelPlugin'

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
  return new Promise((resolve, reject) => {
    let transformCode
    const constituency: any = [];

    try {
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

      if (!window.Babel) {
        loadBabel()
        reject('当前环境 BaBel编译器 未准备好')
      } else {
        transformCode = window.Babel.transform(code, options).code
      }

    } catch (error) {
      console.error("[@transformTsx error]", error);
      reject(error)
    }

    return resolve({ transformCode, constituency })
  })
}

export function transformLess(code): Promise<string> {
  return new Promise((resolve, reject) => {
    let res = ''
    try {
      if (window?.less) {

        if (!code || code.length === 0) {
          return resolve('')
        }

        window.less.render(code, {}, (error, result) => {
          if (error) {
            console.error(error)
            res = ''

            reject(`Less 代码编译失败: ${error.message}`)
          } else {
            res = result?.css
          }
        })
      } else {
        loadLess() // 重试
        reject('当前环境无 Less 编译器，请联系应用负责人')
      }
    } catch (error) {
      reject(error)
    }

    return resolve(res)
  }) as any
}

export function updateRender({ data, success }, renderCode) {
  const writeSource = () => {
    data.runtimeJsxSource = encodeURIComponent(renderCode);
  };
  transformTsx(renderCode).then(({ transformCode, constituency }) => {
    data.runtimeJsxCompiled = encodeURIComponent(transformCode);
    writeSource();
    data.runtimeJsxConstituency = constituency;
    // 清除 runtime.jsx 编译错误以及旧的 React 渲染时 runtime 错误（即将用新代码重新渲染）
    if (!data._errors) data._errors = [];
    data._errors = data._errors.filter(err => err.file !== 'runtime.jsx');
    data._errors = data._errors.filter(err => err.file);
    success?.();
  }).catch(e => {
    console.error("[@transformTsx error]", e);
    writeSource();
    // 添加编译错误到统一错误列表
    if (!data._errors) data._errors = [];
    data._errors = data._errors.filter(err => err.file !== 'runtime.jsx');
    data._errors.push({
      file: 'runtime.jsx',
      message: typeof e === 'string' ? e : (e?.message ?? e?.toString?.() ?? '未知错误'),
      type: 'compile'
    });
    success?.();
  });
}

export function updateStyle({ id, data, success }, styleCode) {
  const writeSource = () => {
    data.styleSource = encodeURIComponent(styleCode);
  };
  transformLess(`.__mybricks_ai_module_id__ {${styleCode}}`).then(css => {
    data.styleCompiled = encodeURIComponent(css);
    writeSource();
    // 清除 style.less 相关错误
    if (!data._errors) data._errors = [];
    data._errors = data._errors.filter(err => err.file !== 'style.less');
    success?.();
  }).catch(e => {
    console.error("[@transformLess error]", e);
    writeSource();
    // 添加编译错误到统一错误列表
    if (!data._errors) data._errors = [];
    data._errors = data._errors.filter(err => err.file !== 'style.less');
    data._errors.push({
      file: 'style.less',
      message: typeof e === 'string' ? e : (e?.message ?? e?.toString?.() ?? '未知错误'),
      type: 'compile'
    });
    success?.();
  });
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

async function loadLess() {
  if (window?.less) {
    return
  }
  await requireFromCdn('https://f2.beckwai.com/udata/pkg/eshop/fangzhou/asset/less/4.2.0/less.js')
}

async function loadBabel() {
  if (window?.Babel) {
    return
  }

  await requireFromCdn('https://f2.beckwai.com/udata/pkg/eshop/fangzhou/asset/babel/standalone/7.24.7/babel.min.js')
}


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