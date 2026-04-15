const pageConfig = 'function definePageConfig(config) { return config }'

export default function (params: { filename: string }) {
  const { filename } = params
  
  return function (babel) {
    const prependHeader = (nodePath, header: string) => {
      const parsedHeader = babel.parse(header, { filename })?.program.body[0]
      nodePath.node.body.unshift(parsedHeader)
    }

    const enterHandler = (nodePath) => {
      const { scope, node } = nodePath

      scope.traverse(node, {
        CallExpression (p) {
          const callee = p.node.callee
          switch (callee.name) {
            case 'defineAppConfig':
              const appConfig = astToValue(p.node.arguments[0])
              const { pages } = appConfig

              let importCode = ''
              let routeCode = ''

              pages.forEach((page) => {
                const componentName = `Page_${page.replace(/[^a-zA-Z0-9]/g, '_')}`
                importCode += `import ${componentName} from './${page}'\n`
                routeCode += `<Route path={'${page}'} element={<${componentName} />}/>`
              })

              const newCode = `
              import { appRef, Routes, Route } from 'mybricks'
              ${importCode}
              
              import App from './app'

              console.log('[App]', App)

              export default function () {
                return (
                  <App>
                    <Routes>
                      ${routeCode}
                    </Routes>
                  </App>
                )
              }
              `

              const result = window.Babel.transform(newCode, {
                presets: [
                  [
                    "env",
                    {
                      "modules": "commonjs"
                    }
                  ],
                  'react'
                ],
                ast: true,
                code: false
              })

              nodePath.node.body = result.ast.program.body
              return
            case 'definePageConfig':
              return prependHeader(nodePath, pageConfig)
            default:
          }
        }
      })
    }
    
    return {
      visitor: {
        Program: { enter: enterHandler }
      }
    };
  }
}

function astToValue(node) {
  if (!node) return undefined
  
  switch (node.type) {
    case 'ObjectExpression':
      const obj = {}
      node.properties.forEach(prop => {
        if (prop.type === 'ObjectProperty') {
          const key = prop.key.name || prop.key.value
          obj[key] = astToValue(prop.value)
        }
      })
      return obj
      
    case 'ArrayExpression':
      return node.elements.map(el => astToValue(el))
      
    case 'StringLiteral':
      return node.value
      
    case 'NumericLiteral':
      return node.value
      
    case 'BooleanLiteral':
      return node.value
      
    case 'NullLiteral':
      return null
      
    default:
      return undefined
  }
}