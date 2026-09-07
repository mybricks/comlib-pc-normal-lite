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
  hasOnComplete: boolean
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
    hasOnComplete: typeof onComplete === 'function',
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

export function completeActiveAuditTransaction(result: AuditResult): boolean {
  const transaction = activeTransaction
  if (!transaction) return false
  const { hasOnComplete } = transaction
  transaction.complete(result)
  return hasOnComplete
}

export function failActiveAuditTransaction(error: Error): void {
  activeTransaction?.fail(error)
}
