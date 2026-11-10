interface DesignerFile {
  path: string
  content: string
}

interface DesignerFileSource {
  getFiles(): Promise<DesignerFile[]>
  updateFiles(files: DesignerFile[]): Promise<void>
  deleteFiles(paths: string[]): Promise<void>
}

/** 将设计器文件状态接入 AgentSandbox。 */
export function createDesignerSandbox(
  source: DesignerFileSource,
  createFileCommands: (files: any) => any,
) {
  const files = {
    async list(path = '', options: { recursive?: boolean } = {}) {
      const prefix = path.replace(/^\/+|\/+$/g, '')
      const entries = new Map<string, { path: string; type: 'file' | 'directory' }>()

      for (const file of await source.getFiles()) {
        const name = file.path.replace(/^\/+/, '')
        if (prefix && !name.startsWith(`${prefix}/`)) continue
        const relative = prefix ? name.slice(prefix.length + 1) : name
        const segments = relative.split('/')
        const count = options.recursive ? segments.length : 1

        for (let index = 1; index <= count; index++) {
          const entryPath = [prefix, ...segments.slice(0, index)].filter(Boolean).join('/')
          entries.set(entryPath, {
            path: entryPath,
            type: index === segments.length ? 'file' : 'directory',
          })
        }
      }

      return [...entries.values()]
    },
    async read(path: string) {
      return (await source.getFiles()).find((file) => file.path === path) ?? null
    },
    async readFiles(paths: string[]) {
      const requested = new Set(paths)
      return (await source.getFiles()).filter((file) => requested.has(file.path))
    },
    async write(file: DesignerFile) {
      await source.updateFiles([file])
    },
    writeFiles: (files: DesignerFile[]) => source.updateFiles(files),
    async remove(path: string) {
      await source.deleteFiles([path])
    },
    removeFiles: (paths: string[]) => source.deleteFiles(paths),
  }

  return { files, commands: createFileCommands(files) }
}
