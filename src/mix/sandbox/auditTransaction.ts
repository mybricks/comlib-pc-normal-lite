export type AuditState = -1 | 0 | 1

export type AuditSection = {
  state: AuditState
  desc: string
}

export type AuditResult = {
  process: AuditSection
  scope: AuditSection
  /** 审查报告的完整 Markdown 原文。 */
  detail: string
}

type ProjectAuditTransaction = {
  kind: 'project'
  complete: (result: AuditResult) => void
  fail: (error: Error) => void
}

let activeTransaction: ProjectAuditTransaction | undefined

export function createAuditTransaction(
  onComplete?: (result: AuditResult) => void,
  onError?: (error: Error) => void,
): void {
  if (activeTransaction) {
    throw new Error('已有审查事务正在进行')
  }

  let settled = false

  const settle = (callback: () => void) => {
    if (settled) return
    settled = true
    activeTransaction = undefined
    callback()
  }

  activeTransaction = {
    kind: 'project',
    complete(result) {
      settle(() => onComplete?.(result))
    },
    fail(error) {
      settle(() => onError?.(error))
    },
  }

}

export function hasActiveAuditTransaction(): boolean {
  return Boolean(activeTransaction)
}

export function completeActiveAuditTransaction(result: AuditResult): void {
  activeTransaction?.complete(result)
}

export function failActiveAuditTransaction(error: Error): void {
  activeTransaction?.fail(error)
}
