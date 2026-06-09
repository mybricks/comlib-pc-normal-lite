import { resolveLocalUrl } from './resolveLocalUrl'

export const VSCODE_CODEEDITOR_LOADER_CONFIG = {
  paths: {
    vs: resolveLocalUrl('./asserts/monaco-editor/0.45.0/min/vs')
  }
}

export const VSCODE_CODEEDITOR_ESLINT = {
  src: resolveLocalUrl('./asserts/eslint/8.15.0/eslint.js'),
  config: {
    env: {
      browser: true,
      es6: true,
    },
    parserOptions: {
      ecmaVersion: 2018,
      sourceType: "module",
    },
  },
}
