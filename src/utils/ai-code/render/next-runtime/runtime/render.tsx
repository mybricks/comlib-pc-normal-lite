import React, {
  useRef,
  useMemo,
  useState,
  forwardRef,
  useLayoutEffect,
  useImperativeHandle } from 'react'
import { FileSystem } from '../utils'
import { useDependencies } from '../hooks'
import type {
  Css,
  Vibing,
  DataSource,
  Dependencies,
  OnRuntimeError,
  OnEnvNamesLoaded
} from '../types'

interface RenderProps {
  dependencies: Dependencies
  DataSource: DataSource
  css: Css
  onEnvNamesLoaded: OnEnvNamesLoaded
  vibing: Vibing
  onMount: (params: { fileSystem: FileSystem }) => void
  onRuntimeError: OnRuntimeError
  entryFile: string
}
interface RenderRef {
  fileSystem: FileSystem
  setEnv: (envName: string) => void
}

const Render = forwardRef<RenderRef, RenderProps>((props, ref) => {
  const dependencies = useDependencies({
    dependencies: props.dependencies,
    DataSource: props.DataSource
  })

  const fileSystem = useRef(new FileSystem({
    dependencies,
    css: props.css
  }))
  const [isInitialized, setIsInitialized] = useState(false)

	useImperativeHandle(ref, () => {
    return {
			fileSystem: fileSystem.current,
      setEnv: (envName: string) => {
        dependencies['mybricks/testing'].activate(envName)
      }
    }
  }, [])

  useLayoutEffect(() => {
    props.onMount({ fileSystem: fileSystem.current })

    fileSystem.current.events.on('init', () => {
      // 初始化执行setup，内部默认执行
      fileSystem.current.get('setup')

      const envNames = dependencies['mybricks/testing'].getEnvNames()
      // 拿到环境信息，回调给外部
      props.onEnvNamesLoaded(envNames)

      setIsInitialized(true)
    })
    return () => {
      // 取消事件监听
      fileSystem.current.events.offAll()
    }
  }, [])

  useLayoutEffect(() => {
    // 设置vibe状态
    fileSystem.current.setVibing(props.vibing)
  }, [props.vibing])

  const Entry = useMemo(() => {
    if (!isInitialized) {
      // [TODO] 提出去作为一个组件
      return () => <div>加载中...</div>
    }
    // [TODO] 配置入口文件
    return fileSystem.current.get(props.entryFile)?.default;
  }, [isInitialized])

  return <Entry />
})

export type { RenderProps, RenderRef }

export default Render
