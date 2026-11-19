export const isAgentFile = (fileName = '') => fileName.replace(/^\//, '').startsWith('.agent/');

export function isRuntimeFile(file: { fileName?: string } | null | undefined): boolean {
  const fileName = file?.fileName;
  return typeof fileName === 'string' && fileName.length > 0 && !isAgentFile(fileName);
}
