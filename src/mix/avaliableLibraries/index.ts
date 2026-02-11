import antd from './antd'
import antDesignIcons from './ant-design-icons'
import echarts from './echarts-for-react'


function getLibraryDocDescription (library: any) {
  return `version: ${library.version}
${library.usage}`
}

export function getLibraryDoc (libraryName: string) {
  switch (libraryName) {
    case 'antd':
      return getLibraryDocDescription(antd)
    case '@ant-design/icons':
      return getLibraryDocDescription(antDesignIcons)
    case 'echarts-for-react':
      return getLibraryDocDescription(echarts)
    default:
      return ''
  }
}