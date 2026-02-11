const NAME = 'develop-javascript-module'
developJavascriptModule.toolName = NAME

interface Config {
  execute: (params: any) => void;
  onOpenCodes: () => void;
}

export default function developJavascriptModule(config: Config) {
  // const {langs,prompts} = comSystemPrompts
  const langs = "浏览器端 JavaScript API"
  // [TODO] 配置的组件文档
  const libTitles = `${langs}`

  return {
    name: NAME,
    displayName: "编写计算逻辑",
    description: `根据用户需求，以及类库知识，一次性便携/修改模块中的所有代码，开发 MyBricks 的 JavaScript 模块。
    
参数：无

工具分类：操作执行类；

作用：编写/修改模块中的所有代码，开发 MyBricks 的 JavaScript 模块；

前置：做任何修改前，必须先查看现有代码的情况。

!IMPORTANT: 所有涉及模块代码的生成/修改都必须使用该工具，一次调用即可完成修改；`,

    getPrompts: () => {
      return `<你的角色与任务>
  你是MyBricks开发专家，技术资深、逻辑严谨、实事求是。
  你的主要任务是设计开发 MyBricks 的 JavaScript 模块（以下简称模块），同时，你也可以根据用户的需求，对模块进行修改、优化、升级等。
</你的角色与任务>

<模块定义及文件说明>
当前模块的【源代码】由 [TODO] x 个文件构成；

[TODO] 文件说明
</模块定义及文件说明>

<模块开发要求>
  在设计开发模块时
  
  <技术栈和类库使用说明>
    仅可以基于 ${libTitles} 技术栈进行开发，同时，可以使用*项目信息*中<允许使用的类库/>中声明类库，根据场景做合理的技术方案设计、不要超出声明的类库范围。
    三方类库：*项目信息*中<允许使用的类库/>中声明的类库；
    > 关于三方类库：仅允许使用*项目信息*中<允许使用的类库/>中声明的类库，不要超出范围；
      同时需要注意以下几点：
      - 按照文档中的使用说明来使用类库，比如*引用方式*、*何时使用*，*组件用法*等。
  </技术栈和类库使用说明>

  注意：
  1、要严格参考 <技术栈和类库使用说明/> 来开发；
  2、你要完成的是中文场景下的开发任务，请仔细斟酌文案、用语，在各类文案表达中尽量使用中文，但是对于代码、技术术语等，可以使用英文。
</模块开发要求>
`
    },
    getPrompts2: () => {
      return `

<按照以下情况分别处理>
  对于用户的各类问题，请按照以下不同的情况进行逐步思考，给出答案。
  
  首先，判断需求属于以下哪种情况：

  <以下问题做特殊处理>
    当用户询问以下类型的问题时，给与特定的答案：
    1、与种族、宗教、色情等敏感话题相关的问题，直接回复“抱歉，我作为智能开发助手，无法回答此类问题。”；
  </以下问题做特殊处理>
  
  如果确实要修改模块，按照以下步骤处理：

  [TODO] 当需要修改 xxx 文件时

  [TODO] 返回格式说明
</按照以下情况分别处理>

<examples>
[TODO] 示例
</examples>
`
    },
    execute(params: any) {
      config.execute(params);
      return "编写完成"
    },
    aiRole: ({ params, hasAttachments }) => {
      const mode = params?.mode ?? 'generate';
      return (mode === 'generate' && !hasAttachments) ? 'junior' : 'architect'
    },
    hooks: {
      before: () => {
        config.onOpenCodes?.()
      }
    }
  };
}
