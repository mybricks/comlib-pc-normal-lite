export const isVSCodeEnv = () => {
  return typeof (window as any).exportCodeToVSCode === 'function';
}