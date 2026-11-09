import getI18n from '../../helpers/i18n'

export type TaskStatus = '处理中' | '待验证' | '待交接' | '已完成'

export const i18n = {
  listView: () => getI18n({ zh: '任务列表', en: 'Task list' }),
  overviewView: () => getI18n({ zh: '模块总览', en: 'Module overview' }),
  overviewEmpty: () => getI18n({ zh: '暂无模块总览，生成任务时会逐步建立关联', en: 'No module overview yet. It will be built as tasks are created.' }),
  overviewInvalid: () => getI18n({ zh: '模块总览文件格式有误，请检查 overview.yaml', en: 'The module overview is invalid. Check overview.yaml.' }),
  overviewPage: () => getI18n({ zh: '页面', en: 'Page' }),
  overviewGlobal: () => getI18n({ zh: '全局入口', en: 'Global entry' }),
  overviewComponent: () => getI18n({ zh: '组件', en: 'Component' }),
  overviewNoImpact: () => getI18n({ zh: '图中暂无关联节点', en: 'No linked nodes in this diagram' }),
  overviewClear: () => getI18n({ zh: '清除关联高亮', en: 'Clear highlights' }),
  closeHint: () => getI18n({ zh: '关闭提示', en: 'Dismiss hint' }),
  all: () => getI18n({ zh: '全部', en: 'All' }),
  noItems: () => getI18n({ zh: '暂无', en: 'None' }),
  selected: (count: number) => getI18n({ zh: `已选 ${count} 项`, en: `${count} selected` }),
  adjust: () => getI18n({ zh: '调整', en: 'Update' }),
  noSharedAction: () => getI18n({ zh: '无共同可执行操作', en: 'No shared action' }),
  clearSelection: () => getI18n({ zh: '取消选择', en: 'Clear selection' }),
  batchDisabled: () => getI18n({ zh: '任务数量不足，无法批量调整', en: 'Select at least two tasks to batch update' }),
  batchUpdate: () => getI18n({ zh: '批量调整任务状态', en: 'Batch update task status' }),
  batchUpdateShort: () => getI18n({ zh: '批量调整', en: 'Batch update' }),
  verification: () => getI18n({ zh: '验证条件', en: 'Verification' }),
  handoverTo: () => getI18n({ zh: '交接给', en: 'Handover to' }),
  addToChat: () => getI18n({ zh: '添加到对话', en: 'Add to chat' }),
  deleteTask: () => getI18n({ zh: '删除此任务', en: 'Delete task' }),
  deleteConfirm: () => getI18n({ zh: '删除后任务和相关修改都会被删除，确认让 AI 删除此任务？', en: 'Delete this task and its related changes?' }),
  sameStatusOnly: () => getI18n({ zh: '只能同时选择相同状态的任务', en: 'Only tasks with the same status can be selected together' }),
  collapseDetails: () => getI18n({ zh: '收起详情', en: 'Hide details' }),
  expandDetails: () => getI18n({ zh: '展开详情', en: 'Show details' }),
  noResults: () => getI18n({ zh: '无匹配结果', en: 'No matching tasks' }),
  addedToChat: () => getI18n({ zh: '已添加到对话输入框', en: 'Added to chat input' }),
  addedToChatWithReason: () => getI18n({ zh: '已添加到对话输入框，请补充原因后发送', en: 'Added to chat input. Add a reason before sending.' }),
  handedToAI: () => getI18n({ zh: '已交给 AI 处理', en: 'Sent to AI' }),
  statusUpdated: () => getI18n({ zh: '已更新任务状态', en: 'Task status updated' }),
  statusUpdateFailed: () => getI18n({ zh: '任务状态更新失败，请重试', en: 'Failed to update task status. Please try again.' }),
  reasonPrompt: () => getI18n({ zh: '请填写原因', en: 'Please provide a reason' }),
  reasonLabel: () => getI18n({ zh: '原因：', en: 'Reason: ' }),
  taskMessagePrefix: (title: string) => getI18n({ zh: `任务「${title}」：`, en: `Task "${title}": ` }),
  transitionReady: () => getI18n({ zh: '代码已完成，等待我验证', en: 'Code is complete and ready for verification' }),
  transitionVerified: () => getI18n({ zh: '已验证完成', en: 'Verification passed' }),
  transitionNeedsFix: () => getI18n({ zh: '任务有问题，请重新修改', en: 'This task needs revision' }),
  attentionTitle: () => getI18n({ zh: '点击查看待验证任务', en: 'View tasks awaiting verification' }),
  attentionBefore: (count: number) => getI18n({ zh: `有 ${count} 个任务已经改完了，需要您帮忙验证下结果，如果没问题可以`, en: `${count} task${count === 1 ? '' : 's'} need verification. If everything looks right,` }),
  attentionLink: () => getI18n({ zh: '告知我', en: 'tell me' }),
  attentionAfter: () => getI18n({ zh: '结果', en: ' the result.' }),
  attentionLinkTitle: () => getI18n({ zh: '打开对话，告知我结果', en: 'Open chat and tell me the result' }),
  status: (status: TaskStatus) => {
    const labels: Record<TaskStatus, { zh: string; en: string }> = {
      '处理中': { zh: '处理中', en: 'Progress' },
      '待验证': { zh: '待验证', en: 'Verify' },
      '待交接': { zh: '待交接', en: 'Handoff' },
      '已完成': { zh: '已完成', en: 'Done' },
    }
    return getI18n(labels[status])
  },
  metadataLabel: (label: string) => {
    const labels: Record<string, { zh: string; en: string }> = {
      '更新时间': { zh: '更新时间', en: 'Updated' },
      '交接给': { zh: '交接给', en: 'Handover to' },
      '交接原因': { zh: '交接原因', en: 'Handover reason' },
      '验证进展': { zh: '验证进展', en: 'Verification progress' },
    }
    return labels[label] ? getI18n(labels[label]) : label
  },
}
