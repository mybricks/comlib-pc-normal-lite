import { Events } from '../../../utils/events'
import { executeLocalShellCommand } from '../sandbox'
import { randomUUID } from '../../../mix/utils/uuid'
import { Comment } from './comment'

export interface VersionRecord {
  id: string;
  turnId?: string;
  label: string;
  type: 'ai' | 'manual' | 'rollback' | 'init';
  createdAt: number;
  summary?: string;
  diff?: string
}

function buildRollbackCommand(diffs: string[]): string {
  const lines: string[] = [
    'set -e',
    'patch_file="$(mktemp)"',
    `trap 'rm -f "$patch_file"' EXIT`,
  ]

  diffs.forEach((diff, index) => {
    const delimiter = `__ROLLBACK_DIFF_${index}__`
    lines.push(`cat <<'${delimiter}' > "$patch_file"`)
    lines.push(diff)
    lines.push(delimiter)
    lines.push('git apply -R --whitespace=nowarn "$patch_file"')
  })

  return lines.join('\n')
}

class Version {
  list: VersionRecord[] = []

  constructor() {
    this.events.emit('list', this.list)
  }

  events = new Events<{
    list: VersionRecord[]
  }>

  getList() {
    return this.list
  }

  add(record: VersionRecord) {
    this.list.unshift(record)
    this.events.emit('list', this.list)
  }

  update(id: string, record: Partial<VersionRecord>) {
    const itemIndex = this.list.findIndex((item) => item.turnId === id)
    if (itemIndex >= 0) {
      this.list[itemIndex] = { ...this.list[itemIndex], ...record }
      this.events.emit('list', this.list)
    }
  }

  async rollback(id: string) {
    // 回滚到 id 对应版本
    const itemIndex = this.list.findIndex(item => item.id === id)
    if (itemIndex < 0) return

    const diffs = this.list
      .slice(0, itemIndex)
      .map((item) => item.diff)
      .filter((diff) => !!diff)

    if (!diffs.length) return

    const command = buildRollbackCommand(diffs as string[])
    await executeLocalShellCommand(command, { timeoutMs: 10_000 })
    const gitDiff = (await executeLocalShellCommand('git diff && git add .', { timeoutMs: 10_000 })).stdout
    if (gitDiff) {
      this.add({
        id: randomUUID(),
        label: `V${this.list.length}`,
        type: 'rollback',
        createdAt: Date.now(),
        diff: gitDiff,
        summary: `回滚自 ${this.list[itemIndex].label}`
      })
    }
  }
}

class Context {
  version = new Version()
  comment = new Comment()
}

let context: Context | null = null

function createContext(): Context {
  const instance = new Context()
  if (typeof window !== 'undefined') {
    ;(window as any)._context_ = instance
  }
  return instance
}

function getContext(): Context {
  if (!context) {
    context = createContext()
  }
  return context
}

const contextProxy = new Proxy({} as Context, {
  get(_target, prop, receiver) {
    return Reflect.get(getContext(), prop, receiver)
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(getContext(), prop, value, receiver)
  },
  has(_target, prop) {
    return prop in getContext()
  },
  ownKeys() {
    return Reflect.ownKeys(getContext())
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getContext(), prop)
  },
})

export default contextProxy
