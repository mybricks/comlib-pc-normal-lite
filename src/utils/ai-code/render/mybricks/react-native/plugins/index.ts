import injectStyleInfoPlugin from './injectStyleInfoPlugin'
import wrapReactNativeComponentPlugin from './wrapReactNativeComponentPlugin'

export default function () {
  return [
    injectStyleInfoPlugin(),
    wrapReactNativeComponentPlugin()
  ]
}