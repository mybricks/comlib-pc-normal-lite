const NAME = 'load-extra-component-docs'
classLibrarySelection.toolName = NAME

interface Config {
  onOpenLibraryDoc: (libraryDoc: any[]) => void;
  librarySummaryDoc: string;
  fileFormat: (params: { fileName: string; content: string }) => string;
}

export default function classLibrarySelection(config: Config) {
  const { fileFormat, librarySummaryDoc } = config;

  return {
    name: NAME,
    displayName: "查看使用文档",
    description: `根据用户需求，从知识库中提供的类库文档中进行查询，当前知识库是关于antd、echarts相关的使用文档，仅在决定使用这些类库时，才需要查询使用文档。
`,
    getPrompts: () => {
      return `
<你的角色与任务>
  你是MyBricks模块设计规划专家，技术资深、逻辑严谨、实事求是，同时具备专业的审美和设计能力。
  你的任务是根据用户的需求、确定<MyBricks模块开发要求/>完成MyBricks模块（以下简称模块、或MyBricks组件）开发所需要的类库，返回 require.json 文件。
</你的角色与任务>

<MyBricks模块开发要求>
  在设计开发MyBricks模块时，可以采用的技术方案来自：
  
  <技术栈声明>
    仅可以基于 React、Less 技术栈进行开发，同时，可以使用下面声明的类库，不要超出当前允许的类库范围。
    类库由markdown格式构成，尤其要关注 "简介" 、"组件列表"或“组件声明”、“注意事项”以及“示例” 等部分。
    
    此外，对于类库中组件的详细说明，可以参考用户在知识库中提供的文档。
    ${librarySummaryDoc}
  </技术栈声明>

  注意：
  1、在技术方案分析过程中，要严格参考 <技术栈及类库声明/> 中的内容，除其中允许使用的框架及类库之外、不允许使用其他任何库或框架；
  2、禁止假设类库，禁止使用相对路径下的文件（例如./XX)；
  3、禁止主观臆造不存在的组件、图标等，只能基于事实上提供的组件及API进行开发；
</MyBricks模块开发要求>

<处理步骤>
  <开发所需要的知识描述>
    返回对需要加载的类库描述，按照以下格式：

    ${fileFormat({
      fileName: "require.json",
      content: '[{"lib":"类库","item":"组件"}]'
    })}
  </开发所需要的知识描述>

  整个过程中要注意：
  - 无需给出任何代码注释；
  - 回答问题请确保结果合理严谨、言简意赅，不要出现任何错误;
  - 回答语气要谦和、慎用叹号等表达较强烈语气的符号等，尽量不要用“代码”、“逻辑”等技术术语；
  - 在向用户做确认时，一次性返回所有问题、不要拆分成多步；
</处理步骤>

<examples>
（注意，以下例子中在不同的类库要求下使用的具体类库名称、方法、属性等可能会有所不同，具体以实际情况为准）
  <example>
    <user_query>根据图片进行开发</user_query>
    <assistant_response>
    ${fileFormat({
      fileName: "require.json",
      content: '[{"lib":"antd","item":"Button"}]'
    })}
  </assistant_response>
  </example>
</examples>
`
    },
    execute(params: any) {
      let requireData = []
      const requireFile = params?.files?.[0];
      if (requireFile?.extension === 'json') {
        try {
          requireData = JSON.parse(requireFile.content);
        } catch (error) {
          console.error("[@类库选型 - execute] 解析require.json失败", error);
        }
      }
      config.onOpenLibraryDoc(requireData ?? [])
      return "已经获取相关知识库文档"
    },
  };
}

