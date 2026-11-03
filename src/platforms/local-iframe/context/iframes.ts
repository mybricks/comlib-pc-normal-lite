export type IframeInfo = {
  doc: Document | null
}

export class Iframes {
  private routes = new Map<string, Map<string, IframeInfo>>()

  get(path: string): ReadonlyMap<string, IframeInfo> | undefined {
    return this.routes.get(path)
  }

  set(path: string, src: string, info: IframeInfo): void {
    let iframes = this.routes.get(path)
    if (!iframes) {
      iframes = new Map()
      this.routes.set(path, iframes)
    }
    iframes.set(src, info)
  }

  delete(path: string, src: string): void {
    const iframes = this.routes.get(path)
    iframes?.delete(src)
    if (iframes?.size === 0) this.routes.delete(path)
  }

  clear(): void {
    this.routes.clear()
  }
}
