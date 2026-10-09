import { Events } from '../../../utils/events'
import { captureVersionGitDiff, executeLocalShellCommand } from '../sandbox'
import { randomUUID } from '../../../mix/utils/uuid'
import commonLang from '../../../helpers/i18n/common'

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

  const delimiter = '__ROLLBACK_DIFF__'
  lines.push(`cat <<'${delimiter}' > "$patch_file"`)
  lines.push(diffs.join('\n'))
  lines.push(delimiter)
  // Apply all reverse patches in one operation so a failed patch does not
  // leave earlier versions partially rolled back.
  lines.push('git apply -R --whitespace=nowarn "$patch_file"')

  return lines.join('\n')
}

export class Version {
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

  async rollback(id: string): Promise<boolean> {
    // 回滚到 id 对应版本
    const itemIndex = this.list.findIndex(item => item.id === id)
    if (itemIndex < 0) return false

    const diffs = this.list
      .slice(0, itemIndex)
      .map((item) => item.diff)
      .filter((diff) => !!diff)

    if (!diffs.length) return false

    const command = buildRollbackCommand(diffs as string[])
    const result = await executeLocalShellCommand(command, { timeoutMs: 10_000 })
    if (result.exitCode !== 0) return false

    const gitDiff = await captureVersionGitDiff()
    if (gitDiff) {
      this.add({
        id: randomUUID(),
        label: `V${this.list.length}`,
        type: 'rollback',
        createdAt: Date.now(),
        diff: gitDiff,
        summary: `${commonLang.rollbackFrom} ${this.list[itemIndex].label}`
      })
    }

    return true
  }
}
