# Mybricks PC端通用组件库 (Lite版本)

<div align="center">
  <p>轻量级的PC端通用组件库，为MyBricks低代码平台提供基础组件支持</p>
</div>

## ✨ 特性

- 🚀 轻量级设计，包含最常用的基础组件
- 🎨 简洁的UI设计，开箱即用
- 📦 零外部依赖（除React外）
- 🔧 完整的TypeScript支持
- 🌍 支持国际化

## 📦 组件列表

### 基础组件

- **文本 (Text)**: 用于展示文本内容的基础组件
- **按钮 (Button)**: 可点击的按钮组件，支持多种样式
- **输入框 (Input)**: 用于接收用户输入的文本框组件

## 🔨 开发

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

### 构建

```bash
npm run build
```

## 📝 使用说明

本组件库基于MyBricks平台开发，可在MyBricks编辑器中直接使用。

### 环境依赖

组件运行时需要以下环境方法：

```typescript
const env = {
  i18n(text: string) {
    // 多语言定制
    return text;
  }
};
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

ISC