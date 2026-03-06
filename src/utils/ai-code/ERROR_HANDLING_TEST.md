# 错误处理测试说明

## 测试场景

### 1. 编译错误测试

#### JSX 编译错误
```jsx
// 在 runtime.jsx 中故意写错误语法
export default forwardRef((props, ref) => {
  return <div>test<div>  // 缺少闭合标签
});
```
**期望结果**：
- `data._errors` 中应该有一条记录：`{ file: 'runtime.jsx', message: '...', type: 'compile' }`
- 错误面板显示 "JSX 编译失败 (runtime.jsx)"
- 有 "交给 AI 修复" 按钮

#### Less 编译错误
```less
// 在 style.less 中故意写错误语法
.container {
  color: red
  background: blue  // 缺少分号
}
```
**期望结果**：
- `data._errors` 中应该有一条记录：`{ file: 'style.less', message: '...', type: 'compile' }`
- 错误面板显示 "Less 编译失败 (style.less)"

#### Store.js 编译错误（语法错误）
```javascript
// 在 store.js 中故意写语法错误
export default class Store {
  constructor() {
    this.data = {
      count: 0
    }  // 缺少分号或闭合括号
  }
}
```
**期望结果**：
- `data._errors` 中应该有一条记录：`{ file: 'store.js', message: 'Store 编译失败: ...', type: 'compile' }`
- 错误面板显示 "Store 编译失败 (store.js)"
- **在保存时立即显示错误**，不需要等到运行时

#### Store.js 执行错误（运行时错误）
```javascript
// 在 store.js 中写语法正确但会导致运行时错误的代码
export default class Store {
  constructor() {
    this.data = undefined.property;  // 访问 undefined 的属性
  }
}
```
**期望结果**：
- `data._errors` 中应该有一条记录：`{ file: 'store.js', message: 'Store 执行失败: ...', type: 'runtime' }`
- 错误面板显示 "Store 执行失败 (store.js)"
- **在组件渲染时才显示错误**（因为是运行时错误）

### 2. 运行时错误测试

#### React 渲染错误
```jsx
// 在 runtime.jsx 中写会导致运行时错误的代码
export default forwardRef((props, ref) => {
  const obj = null;
  return <div>{obj.property}</div>  // 访问 null 的属性
});
```
**期望结果**：
- ErrorBoundary 捕获错误
- `data._errors` 中应该有一条记录：`{ message: '...', type: 'runtime' }`（无 file 字段）
- 错误面板显示 "组件运行时错误"

### 3. 错误清除测试

#### 编译错误修复后清除
1. 先产生一个 JSX 编译错误
2. 修复代码并保存
**期望结果**：
- `data._errors` 中的 `runtime.jsx` 错误应该被清除
- 组件正常渲染

#### 运行时错误修复后清除
1. 先产生一个运行时错误
2. 修复代码并保存
**期望结果**：
- `data._errors` 中的运行时错误应该被清除
- 组件正常渲染

### 4. 多错误展示测试

#### 同时存在多个错误
1. 在 runtime.jsx 中写错误语法（编译错误）
2. 在 style.less 中写错误语法（编译错误）
3. 保存后修复 runtime.jsx，但在代码中引入运行时错误
**期望结果**：
- `data._errors` 中应该有 2 条记录：style.less 编译错误 + 运行时错误
- 错误面板优先显示运行时错误
- 点击 "查看所有错误 (2)" 可展开查看所有错误

## 验证点

### 数据结构验证
在浏览器控制台中检查：
```javascript
// 假设组件 ID 是 'u_abc123'
const data = // 获取组件 data
console.log(data._errors);
// 应该输出类似：
// [
//   { file: 'runtime.jsx', message: '...', type: 'compile' },
//   { file: 'style.less', message: '...', type: 'compile' },
//   { message: '...', type: 'runtime' }
// ]
```

### UI 验证
- 错误面板标题正确显示文件名
- 错误信息清晰可读
- 多个错误时显示折叠面板
- "交给 AI 修复" 按钮可点击

### 生命周期验证
1. **componentDidMount**：组件成功挂载时清除运行时错误
2. **componentDidUpdate**：组件更新后如果成功渲染，清除运行时错误
3. **componentDidCatch**：捕获错误并添加到 `data._errors`
4. **getDerivedStateFromError**：设置错误状态

## 修复的问题总结

### 问题1：运行时错误捕获
✅ 添加 `getDerivedStateFromError` 静态方法
✅ 在 `componentDidCatch` 中添加错误到 `data._errors`
✅ ErrorBoundary 包裹组件并传递 `data` prop

### 问题2：错误修复后自动清除
✅ `componentDidMount`：组件成功挂载时清除运行时错误
✅ `componentDidUpdate`：组件更新后清除运行时错误
✅ `ReactNode` useMemo：组件定义成功获取时清除运行时错误

### 问题3：文件更新时清除对应错误
✅ `updateRender`：清除 runtime.jsx 错误
✅ `updateStyle`：清除 style.less 错误
✅ `updateFile` (store.js)：清除 store.js 错误并进行编译验证

### 问题4：store.js 编译错误捕获
✅ 在 `context/index.ts` 的 `updateFile` 中添加编译验证
✅ 使用 `new Function()` 在保存时就检测语法错误
✅ 区分编译错误（type: 'compile'）和运行时错误（type: 'runtime'）

## 错误类型说明

### Store.js 的两种错误

#### 1. 编译错误（语法错误）- 保存时捕获
- **捕获位置**：`context/index.ts` - updateFile
- **触发时机**：保存 store.js 文件时
- **错误类型**：`{ file: 'store.js', type: 'compile' }`
- **示例**：缺少括号、分号，语法不符合 JavaScript 规范

#### 2. 运行时错误（执行错误）- 渲染时捕获
- **捕获位置**：`render/index.tsx` - evalJSCompiled
- **触发时机**：组件渲染时执行 store 构造函数
- **错误类型**：`{ file: 'store.js', type: 'runtime' }`
- **示例**：访问 undefined 的属性，调用不存在的方法

## 错误清除时机总结

| 错误类型 | 清除时机 | 位置 |
|---------|---------|------|
| **runtime.jsx 编译错误** | ✅ 文件更新时 | transform-umd.ts |
| **style.less 编译错误** | ✅ 文件更新时 | transform-umd.ts |
| **store.js 编译错误** | ✅ 文件更新时 | context/index.ts |
| **store.js 运行时错误** | ✅ 组件渲染时 | render/index.tsx |
| **React 运行时错误** | ✅ 组件成功挂载/更新时 | render/index.tsx |

