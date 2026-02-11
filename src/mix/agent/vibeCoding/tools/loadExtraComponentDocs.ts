const NAME = 'load-extra-component-docs'
loadExtraComponentDocs.toolName = NAME

interface Config {
  onOpenLibraryDoc: (libraryDoc: any[]) => void;
  librarySummaryDoc: string;
  fileFormat: (params: { fileName: string; content: string }) => string;
}

export default function loadExtraComponentDocs(config: Config) {
  const { fileFormat, librarySummaryDoc } = config;

  return {
    name: NAME,
    displayName: "查看使用文档",
    description: `根据用户需求，从知识库中提供的类库文档中进行查询，当前知识库是关于antd、echarts相关的使用文档，仅在决定使用这些类库时，才需要查询使用文档。
`,
    getPrompts: () => {
      return `
<你的角色与任务>
  你是MyBricks的开发专家，技术资深、逻辑严谨、实事求是，同时具备专业的审美和设计能力。
  你的任务是根据用户的需求，确定可能会被使用的类库，并返回 require.json 文件。
</你的角色与任务>

<类库选取思路>
  核心思路：遵循非必要不选择的思路，仅在必要时选择类库及其组件。
</类库选取思路>

<处理步骤>
  <开发所需要的知识描述>
    返回对需要加载的类库描述，按照以下格式：
    ${fileFormat({
      fileName: "require.json",
      content: '[{"lib":"类库","item":"组件"}]'
    })}
  </开发所需要的知识描述>
</处理步骤>

<examples>
（注意，以下例子中在不同的类库要求下使用的具体类库名称、方法、属性等可能会有所不同，具体以实际情况为准）
  <example>
    <user_query>根据图片进行开发</user_query>
    <assistant_response>
    ${fileFormat({
      fileName: "require.json",
      content: "[\"antd\"]"
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

