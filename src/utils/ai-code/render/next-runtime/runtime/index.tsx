import React, { forwardRef } from 'react'
import { useWrapperComponent } from '../hooks'
import ErrorBoundary from './ErrorBoundary'
import Render, { RenderRef, RenderProps } from './render'
import type { Wrapper } from '../types'

interface NextRuntimeProps extends RenderProps {
  wrapper?: Wrapper
}

interface NextRuntimeRef extends RenderRef {}

const NextRuntime = forwardRef<NextRuntimeRef, NextRuntimeProps>((props, ref) => {
	const WrapperComponent = useWrapperComponent(props.wrapper)

	return (
		<WrapperComponent>
			<ErrorBoundary onError={props.onRuntimeError}>
				<Render
					ref={ref}
					{...props}
					// @ts-ignore 引擎特殊处理逻辑
					// _onError_={(error) => {
					// 	props.onRuntimeError(error, error)
					// }}
				/>
			</ErrorBoundary>
		</WrapperComponent>
	)
})

export type { NextRuntimeRef }

export default NextRuntime
