import React, {
  useRef,
  useMemo,
  useState,
  forwardRef,
  useLayoutEffect,
  useImperativeHandle } from 'react'
import { matchfile, FileSystem, extractMissingFiles } from '../utils'
import type {
  Css,
  Vibing,
  DataSource,
  LoadingView,
  Dependencies,
  OnRuntimeError,
} from '../types'

interface RenderProps {
  dependencies: Dependencies
  DataSource: DataSource
  css: Css
  vibing: Vibing
  onMount: (params: { fileSystem: FileSystem }) => void
  onRuntimeError: OnRuntimeError
  entryFile: string
  // [TODO]
  onFileChange: (params: { filename: string, type: string }) => void
  LoadingView: LoadingView
}
interface RenderRef {
  fileSystem: FileSystem
}

const Render = forwardRef<RenderRef, RenderProps>((props, ref) => {
  const fileSystem = useRef(new FileSystem({
    dependencies: props.dependencies,
    css: props.css,
    entryFile: props.entryFile,
    LoadingView: props.LoadingView,
    onRuntimeError: props.onRuntimeError
  }))
  const [isInitialized, setIsInitialized] = useState(false)
  const [vibingEnded, setVibingEnded] = useState(false)

	useImperativeHandle(ref, () => {
    return {
			fileSystem: fileSystem.current,
    }
  }, [])

  useLayoutEffect(() => {
    fileSystem.current.events.on('fileChange', ({ filename, type }) => {
      if (matchfile(props.entryFile, filename) && type === 'create') {
        // 监听入口文件，是否有必要，好像也可以用loading替代
        setIsInitialized(true)
      }
      props.onFileChange({ filename, type })
    })
    // 注册错误监听
    fileSystem.current.setupErrorListeners()
    props.onMount({ fileSystem: fileSystem.current })
    return () => {
      // 取消事件监听
      fileSystem.current.events.offAll()
      // 卸载错误监听
      fileSystem.current.teardownErrorListeners()
    }
  }, [])

  // 管理 vibing 状态
  useLayoutEffect(() => {
    fileSystem.current.setVibing(props.vibing)
    
    if (!props.vibing) {
      setVibingEnded(true)
    } else {
      setVibingEnded(false)
    }
  }, [props.vibing])

  useLayoutEffect(() => {
    if (vibingEnded) {
      // vibe 结束
      if (!isInitialized) {
        // 缺失入口文件
        throw new Error(`入口文件 \`${props.entryFile}\` 缺失，组件无法渲染`)
      } else {
        const { tempFilesMap } = fileSystem.current
        
        if (Object.keys(tempFilesMap).length > 0) {
          const missingFiles = extractMissingFiles(tempFilesMap)
          
          // 构建详细的错误信息，包含依赖关系
          const errorDetails = Object.entries(missingFiles)
            .map(([file, info], index) => {
              return `${index ? '、' : ''}\`${file}\``
            })
            .join('')
          
          throw new Error(`缺失以下依赖文件，组件无法渲染：${errorDetails}`)
        }
      }
    }
  }, [vibingEnded, isInitialized])

  const Entry = useMemo(() => {
    if (!isInitialized) {
      const { LoadingView } = props
      // [TODO] 提出去作为一个组件
      return () => <LoadingView tip="入口文件编写中..." withContainer={true}/>
    }
    // [TODO] 配置入口文件
    return fileSystem.current.get(props.entryFile)?.default;
  }, [isInitialized])

  return <Entry />
})

export type { RenderProps, RenderRef }

export default Render
