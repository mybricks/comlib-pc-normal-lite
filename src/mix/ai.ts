import { updateRender, updateStyle } from '../utils/ai-code/transform-umd'

export default {
  ':root' ({ data }) {
    return {}
  },
  prompts: {
    summary: `AI区域：一个支持自定义编写代码的React组件，支持各类三方库引用。
何时使用：在基础或者现有组件无法满足需求时，建议使用此组件编写代码来实现。建议推荐使用。
`,
    usage: `AI 区域：支持自定义编写代码的 React 组件，可引用各类三方库。当基础或现有组件无法满足需求时，可使用本组件实现。
使用方式
1. 按模块/区域整体使用：以完整功能块为单位使用本组件，避免拆得过细。
  例如：
  - 搜索区域中搜索框组件缺失时，应将「左侧 logo + 右侧搜索框与按钮」整块作为 AI 区域实现，而不是单独用按钮、logo 等组件拼装。
2. 配置需求文档：只需填写需求说明，无需写代码。用一句 Markdown 描述即可，重点是界定组件边界，不必写具体元素（如图片、按钮等）的细节。
  例如：
  - "完成顶部导航栏区域的开发，白色背景，内容为左侧 logo、公告与右侧用户区域"
  - "完成图表区域的开发，白色圆角卡片，内容为右上角筛选与中间折线图"
`,
  },
  editors: [
    {
      title: '常规/需求文档',
      type: 'text',
      value: {
        get: ({ data }) => {
          return data.document;
        },
        set: ({ data }, value) => {
          data.document = value;
        }
      }
    }
  ]
//   editors: {
//     ":root": [
//       {
//         title: "组件runtime代码",
//         type: "jsx-runtime-code-editor",
//         description: `基于react框架编写组件的运行时代码，关注<使用说明>
// **data._renderCode**内容是当前组件runtime经过babel编译、encodeURIComponent转译后的代码

// 在runtime代码中直接通过入参data属性即可获取组件的配置项数据

// 更新组件runtime代码的参数如下：
// \`\`\`typescript
// /** 基于react框架编写组件的运行时代码 */
// type Value = string;
// \`\`\`

// 注意：
//  - 必须编写高可读性的源代码`,
//         value: {
//           set({ data }, value) {
//             updateRender({ data }, value)
//             console.log("[写runtime代码]", value)
//           }
//         }
//       },
//       {
//         title: "组件样式代码",
//         type: "less-code-editor",
//         description: `基于Less框架编写组件的样式代码，关注<使用说明>
// **data._styleCode**内容是当前组件经过less编译、encodeURIComponent转译后的样式代码

// 更新组件样式代码的参数如下：
// \`\`\`typescript
// /** 基于Less框架编写组件的样式代码 */
// type Value = string;
// \`\`\`

// 注意：
//  - 必须编写高可读性的源代码
//  - 更新样式代码后按需同步实现对应的runtime代码
//  `,
//         value: {
//           set({ data }, value) {
//             updateStyle({ data }, value)
//             console.log("[写less代码]", value)
//           }
//         }
//       },
//       {
//         title: "更新输出项",
//         type: "updateOutput",
//         description: `添加组件的输出项，用于内部触发组件的各类事件
// **data.outputs**内容是当前输出项列表

// 更新输出项的参数如下：
// \`\`\`typescript
// interface Params {
//   id: string; // 输出项id
//   title: string; // 输出项语义化名称
//   /**
//    * 操作类型
//    * undefined - 根据是否存在id判断是添加或更新
//    * delete - 删除id对应的输出项
//    */
//   updateType: "delete" | undefined;
// }
// \`\`\`

// 注意：
//  - 更新输出项后按需同步实现对应的runtime代码
// `,
//         value: {
//           set({ data, outputs }, value) {
//             const fn = (value) => {
//               const index = data.outputs.findIndex((output) => output.id === value.id);
//               const isDelete = value.updateType === "delete";

//               if (index !== -1) {
//                 // 配置项存在
//                 if (isDelete) {
//                   // 删除
//                   outputs.remove(value.id);
//                   data.outputs.splice(index, 1);
//                 } else {
//                   // 更新
//                   data.outputs[index] = Object.assign(data.outputs[index], value);
//                   const output = outputs.get(value.id);
//                   if (value.title) {
//                     output.setTitle(value.title);
//                   }
//                 }
//               } else {
//                 // 配置项目不存在
//                 if (!isDelete) {
//                   // 更新，判断下更保险
//                   outputs.add(value.id, value.title);
//                   data.outputs.push(value);
//                 }
//               }
//             }
            
//             if (Array.isArray(value)) {
//               value.forEach((value) => {
//                 fn(value);
//               })
//             } else {
//               fn(value);
//             }

//             console.log("[更新输出项]", value)
//           }
//         }
//       },
//       {
//         title: "更新输入项",
//         type: "updateInput",
//         description: `更新组件的输入项，用于外部调用组件的各类api
// **data.inputs**内容是当前输入项列表

// 更新输入项的参数如下：
// \`\`\`typescript
// interface Params {
//   id: string; // 输入项id
//   title: string; // 输入项语义化名称
//   /**
//    * 操作类型
//    * undefined - 根据是否存在id判断是添加或更新
//    * delete - 删除id对应的输入项
//    */
//   updateType: "delete" | undefined;
// }
// \`\`\`

// 注意：
//  - 更新输入项后按需同步实现对应的runtime代码
// `,
//         value: {
//           set({ data, inputs }, value) {

//             const fn = (value) => {
//               const index = data.inputs.findIndex((input) => input.id === value.id);
//               const isDelete = value.updateType === "delete";

//               if (index !== -1) {
//                 // 配置项存在
//                 if (isDelete) {
//                   // 删除
//                   inputs.remove(value.id);
//                   data.inputs.splice(index, 1);
//                 } else {
//                   // 更新
//                   data.inputs[index] = Object.assign(data.inputs[index], value);
//                   const input = inputs.get(value.id);
//                   if (value.title) {
//                     input.setTitle(value.title);
//                   }
//                 }
//               } else {
//                 // 配置项目不存在
//                 if (!isDelete) {
//                   // 更新，判断下更保险
//                   inputs.add(value.id, value.title);
//                   data.inputs.push(value);
//                 }
//               }
//             }

//             if (Array.isArray(value)) {
//               value.forEach((value) => {
//                 fn(value);
//               })
//             } else {
//               fn(value);
//             }

//             console.log("[更新输入项]", value)
//           }
//         }
//       },
//       {
//         title: "更新配置项",
//         type: "updateConfig",
//         description: `更新一个组件的配置项，配置项用于组件的配置编辑，可以理解为是组件的props
// **data.configs**内容是当前配置项列表

// 更新配置项的参数如下：
// \`\`\`typescript
// type Params = TextParams | StyleParams;
// /**
//  * 操作类型
//  * undefined - 根据是否存在key判断是添加或更新
//  * delete - 删除key对应的配置项
//  */
// type UpdateType = "delete" | undefined;

// intreface ConfigBase {
//   /** 配置项的语义化标题 */
//   title: string;
//   /** 需要配置的语义化字段，对应到组件的入参的data[fieldName] */
//   fieldName: string;
//   /** 唯一的key，没有业务语义，用于查询对应的配置项 */
//   key: string;
//   updateType: UpdateType;
// }

// /** 
//  * 文本类型配置
//  */
// intreface TextParams extends ConfigBase {
//   type: "text";
// }

// /**
//  * 样式配置
//  */
// interface StyleParams {
//   /** 配置项的语义化标题 */
//   title: string;
//   type: "style";
//   /** 样式编辑器配置 */
//   option: {
//     /**
//      * 需要支持的配置内容
//      * font - 字体配置
//      * background - 背景配置
//      */
//     options: string[];
//     /** 样式作用于目标元素的 css selector，多个target代表样式同时作用于多个目标元素 */
//     target: string[];
//   };
//   /** 唯一的key，没有业务语义，用于查询对应的配置项 */
//   key: string;
//   updateType: UpdateType;
// }
// \`\`\`

// 注意：
//  - 样式相关的配置必须使用**样式配置**
//  - 更新配置项后按需同步实现对应的runtime代码
//         `,
//         value: {
//           set({ data }, value) {
//             console.log("[修改配置项]", value)

//             const fn = (value) => {
//               const index = data.configs.findIndex((config) => config.key === value.key);
//               const isDelete = value.updateType === "delete";

//               if (index !== -1) {
//                 // 配置项存在
//                 if (isDelete) {
//                   // 删除
//                   data.configs.splice(index, 1);
//                 } else {
//                   // 更新
//                   data.configs[index] = Object.assign(data.configs[index], value);
//                 }
//               } else {
//                 // 配置项目不存在
//                 if (!isDelete) {
//                   // 更新，判断下更保险
//                   data.configs.push(value);
//                 }
//               }
//             }

//             if (Array.isArray(value)) {
//               value.forEach((value) => {
//                 fn(value);
//               })
//             } else {
//               fn(value);
//             }

//             console.log("[data.configs]", data.configs)
//           }
//         }
//       }
//     ]
//   }
}