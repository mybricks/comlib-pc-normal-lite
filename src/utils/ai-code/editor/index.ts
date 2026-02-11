import { getComponentFromJSX, transformLess, updateRender, updateStyle } from './../transform-umd'

interface AIEditorProps {
  prompts: string,
  langs?: string,
  loadKnowledge?: (items: any) => Array<{ lib: string, item: string, knowledge: string | undefined }> | undefined
  dependencies?: Record<string, any>
}

export const genAIEditor = ({ prompts, langs = `HTML、CSS、Javascript、react`, loadKnowledge, dependencies }: AIEditorProps) => {
  return {
    ':root': {
      active: true,
      role: 'comDev', //定义AI的角色
      getSystemPrompts() {
        return {
          langs,
  //         renderFileTemplate: `
  // ({env,data,inputs,outputs,slots})=>{
  //   useMemo(()=>{
  //     inputs['u_i6']((val)=>{//监听输入项
  //       data.title = val
  //     })
  //   },[])
    
  //   return (
  //     <div>
  //       <div>
  //         {data.logo}
  //       </div>
  //       <Button className={css.button} onClick={e=>{
  //         outputs['o_03'](data.title)
  //       }}>{data.title}</Button>
  //       <div>{slots['s_u01'].render()}</div>
  //     </div>
  //   )
  // }
  //         `,
          prompts: prompts,
        }
      },
      loadKnowledge,
      preview(response: { runtime, style }, edtCtx, libs: { mybricksSdk }) {
        return new Promise((resolve, reject) => {
          if (response) {
            const rtn = (com, css) => {
              resolve({
                com,
                css
              })
            }
            Promise.all([
              getComponentFromJSX(response.runtime, libs, dependencies),
              transformLess(response.style)
            ]).then(([com, css]) => {
              rtn(com, css)
            }).catch(e => {
              reject(e)
            })
          }
        })
      },
      execute(
        { id, data, inputs, outputs, slots },
        response: { runtime; style }
      ) {
        return new Promise((resolve, reject) => {
          if (response) {
            if (!(response.runtime || response.style)) {
              resolve(true)
              return
            }

            if (response.runtime) {
              updateRender({ data }, response.runtime)
            }

            if (response.style) {
              updateStyle({ data }, response.style)
            }

            resolve(true)
          }
        })
      },
    },
  }
}