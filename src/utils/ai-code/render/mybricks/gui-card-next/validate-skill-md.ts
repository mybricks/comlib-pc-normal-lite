/**
 * SKILL.md 格式校验工具
 *
 * 预期的 SKILL.md 格式（文件必须以 frontmatter 块开头）：
 * ---
 * name: skill-name          # 必填，英文 kebab-case（小写字母、数字、中划线），供大模型识别
 * title: 技能中文标题        # 必填，对应 name 的中文标题，供用户阅读理解
 * description: 一句话说明 skill 的功能及使用时机   # 必填
 * ---
 *
 * 技能的详细说明内容...（必填，frontmatter 之后必须有正文）
 */

export interface SkillMdError {
  /** 错误所在文件路径 */
  file: string
  /** 错误描述 */
  message: string
  /** 错误类型 */
  type: 'compile'
}

/**
 * 校验 SKILL.md 文件格式
 * @param filename 文件路径（用于错误提示）
 * @param content  文件内容
 * @returns 错误列表，无错误时返回空数组
 */
export function validateSkillMd(filename: string, content: string): SkillMdError[] {
  const errors: SkillMdError[] = []
  const md = content.trim()

  // 1. 必须以 frontmatter 开头
  const frontmatterMatch = md.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) {
    errors.push({
      file: filename,
      message: [
        `[SKILL.md] ${filename}：文件开头必须包含 YAML frontmatter 块。`,
        `请按如下格式添加（注意 name 用英文 kebab-case，title 用中文）：`,
        `---`,
        `name: skill-name`,
        `title: 对应 name 的中文标题`,
        `description: 一句话说明 skill 功能以及使用时机`,
        `---`,
      ].join('\n'),
      type: 'compile',
    })
    return errors
  }

  // 2. 解析 frontmatter 字段
  const frontmatterText = frontmatterMatch[1]
  const frontmatter: Record<string, string> = {}
  frontmatterText.split('\n').forEach((line) => {
    const colonIdx = line.indexOf(':')
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      frontmatter[key] = value
    }
  })

  // 3. 校验必填字段
  const requiredFields: Array<{ key: string; label: string; hint: string }> = [
    {
      key: 'name',
      label: 'name',
      hint: '英文 kebab-case（小写字母、数字、中划线），供大模型识别，例如：my-skill-name',
    },
    {
      key: 'title',
      label: 'title',
      hint: '对应 name 的中文标题，供用户阅读理解，例如：我的技能',
    },
    {
      key: 'description',
      label: 'description',
      hint: '一句话说明 skill 的功能以及使用时机',
    },
  ]

  for (const { key, label, hint } of requiredFields) {
    if (!frontmatter[key]) {
      errors.push({
        file: filename,
        message: `[SKILL.md] ${filename}：frontmatter 缺少必填字段 "${label}"（${hint}）`,
        type: 'compile',
      })
    }
  }

  // 4. name 字段格式校验：必须为 kebab-case（小写字母、数字、中划线，且以字母或数字开头）
  if (frontmatter.name && !/^[a-z0-9][a-z0-9-]*$/.test(frontmatter.name)) {
    errors.push({
      file: filename,
      message: `[SKILL.md] ${filename}：name 字段 "${frontmatter.name}" 格式不合法，必须使用英文 kebab-case（只含小写字母、数字、中划线，且以字母或数字开头），例如：my-skill-name`,
      type: 'compile',
    })
  }

  // 5. 必须有正文内容（frontmatter 之后）
  const bodyStart = md.indexOf('---', md.indexOf('---') + 3) + 3
  const body = md.slice(bodyStart).trim()
  if (!body) {
    errors.push({
      file: filename,
      message: `[SKILL.md] ${filename}：frontmatter 之后缺少技能说明正文，请在 "---" 结束行之后添加 skill 的详细说明内容`,
      type: 'compile',
    })
  }

  return errors
}
