const NAME = 'read-module-code'
readModuleCode.toolName = NAME


interface Config {
  onOpenCodes: () => void;
}

/**
 * 读取代码的工具函数
 * 用于读取代码并返回对应的代码结果
 */
export default function readModuleCode(cofig: Config): any {
  return {
    name: NAME,
    displayName: "查看代码",
    description: `读取Mybricks模块的所有代码文件并返回对应的代码结果。
参数：无；
作用：查看Mybricks模块的所有代码文件并返回对应的代码结果；
返回值：代码；
`,
    execute({}) {
      cofig.onOpenCodes()
      return '已经查看所有模块代码文件'
    },
  };
}

