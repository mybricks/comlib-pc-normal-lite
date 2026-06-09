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
  ErrorView,
  LoadingView,
  Definitions,
  Dependencies,
  OnRuntimeError,
} from '../types'

const IS_STRANGE_ENV = () => {
  return window['__IS_AICODE__'] || (typeof window !== 'undefined' ? (window as any).webViewMessageApi : undefined)
}

interface RenderProps {
  dependencies: Dependencies
  css: Css
  vibing: Vibing
  onMount: (params: { fileSystem: FileSystem }) => void
  onRuntimeError: OnRuntimeError
  entryFile: string
  // [TODO]
  onFileChange: (params: { filename: string, type: string }) => void
  LoadingView: LoadingView
  ErrorView: ErrorView
  definitions: Definitions
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
    onRuntimeError: props.onRuntimeError,
    ErrorView: props.ErrorView,
    definitions: props.definitions
  }))
  const [error, setError] = useState<Error | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [vibingEnded, setVibingEnded] = useState(false)

	useImperativeHandle(ref, () => {
    return {
			fileSystem: fileSystem.current,
    }
  }, [])

  useLayoutEffect(() => {
    // 预加载入口文件
    fileSystem.current.get(props.entryFile, { isEntry: true })
    fileSystem.current.events.on('fileChange', ({ filename, type }) => {
      if (matchfile(props.entryFile, filename)) {
        fileSystem.current.error = null
        if (type === 'create') {
          // 监听入口文件，是否有必要，好像也可以用loading替代
          setIsInitialized(true)
        } else if (type === 'update') {
          setError(null)
        }
      }
      if (IS_STRANGE_ENV()) {
        setError(null)
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
      fileSystem.current.tempDependencies.clear()
      setVibingEnded(false)
    }
  }, [props.vibing])

  useLayoutEffect(() => {
    if (vibingEnded) {
      // vibe 结束
      if (!isInitialized) {
        const error = new Error(`入口文件 \`${props.entryFile}\` 缺失，组件无法渲染`)
        fileSystem.current.error = error
        // 缺失入口文件
        setError(error)
      } else {
        const { tempFilesMap, tempDependencies } = fileSystem.current

        let errorMessage = ''
        
        if (Object.keys(tempFilesMap).length > 0) {
          const missingFiles = extractMissingFiles(tempFilesMap)
          
          // 构建详细的错误信息，包含依赖关系
          const errorDetails = Object.entries(missingFiles)
            .map(([file, info], index) => {
              const dependents = Array.from(info.dependedBy).join('、')
              return `${index ? '；' : ''}${dependents} 导入了不存在的文件 \`${file}\`${info.isEntry ? '（入口文件）' : ''}，请检查相对路径是否有误，或缺失该文件`
            })
            .join('')

          errorMessage += `以下文件的相对引用无法解析：${errorDetails}\n`
        }

        tempDependencies.forEach((deps, filename) => {
          if (deps.size) {
            errorMessage += `${filename} 使用了不允许的三方依赖：${Array.from(deps).join(', ')}\n`
          }
        })

        if (errorMessage) {
          setError(new Error(errorMessage))
        }
      }
    } else {
      setError(null)
    }
  }, [vibingEnded, isInitialized])

  const Entry = useMemo(() => {
    // if (!isInitialized) {
    //   const { LoadingView } = props
    //   // [TODO] 提出去作为一个组件
    //   return () => <LoadingView tip="入口文件编写中..." withContainer={true}/>
    // }
    // [TODO] 配置入口文件
    return fileSystem.current.get(props.entryFile, { isEntry: true })?.default;
  }, [isInitialized])

  if (error) {
    const ErrorView = props.ErrorView
    return <ErrorView error={error} />
  }

  return (
    <Entry
      // _onError_={null}
      // [TEMP] 特殊处理、判断环境
      _onError_={IS_STRANGE_ENV() ? (error) => {
        props.onRuntimeError(error)
        if (vibingEnded) {
          setError(error)
        }
      } : null}
    />
  )
})

export type { RenderProps, RenderRef }

export default Render
