import genVibeCodingAgent from "../agent/vibeCoding";
import { updateRender, updateStyle, updateService, updateStore } from "../../utils/ai-code/transform-umd";
import { Events } from "../../utils/events";

class Context {
  aiComParamsMap: Record<string, any> = {};
  aiComEvents: Record<string, Events<{
    'debugTarget': any;
  }>> = {};

  getAiComEvents(id: string) {
    let events = this.aiComEvents[id];
    if (!events) {
      events = this.aiComEvents[id] = new Events();
    }
    return events;
  }

  setAiCom(id: string, { params, actions }) {
    if (actions.notifyChanged || actions.getFocusArea || actions.lock || actions.unlock) {
      this.aiComParamsMap[id] = { aiComParams: params, actions };
    }
  }

  getAiCom(id: string) {
    return this.aiComParamsMap[id];
  }

  getAiComParams(id: string) {
    return this.aiComParamsMap[id]?.aiComParams;
  }

  agent: any = {
    vibeCoding: null,
  };

  createVibeCodingAgent({ register }) {
    if (!this.agent.vibeCoding) {
      const that = this;
      const vibeCoding = genVibeCodingAgent({ context: that });
      this.agent.vibeCoding = vibeCoding;
      register(vibeCoding);
    }
  }

  plugins: any;

  /** 生成中：start 后展示流式界面，stream 传全量（多次即流式），end 删 data 并渲染，error 展示错误面板 */
  generate = {
    start: (id: string) => {
      const aiComParams = this.getAiComParams(id);
      if (!aiComParams?.data) return;
      aiComParams.data.generate = true;
      aiComParams.data.generateFileName = '';
      aiComParams.data.generateContent = '';
      aiComParams.data.generateError = false;
      aiComParams.data.generateErrorMessage = '';
      this.getAiCom(id)?.actions?.notifyChanged?.();
    },
    stream: (id: string, payload: { fileName: string; content: string }) => {
      const aiComParams = this.getAiComParams(id);
      if (!aiComParams?.data) return;
      aiComParams.data.generateFileName = payload.fileName ?? '';
      aiComParams.data.generateContent = payload.content ?? '';
      this.getAiCom(id)?.actions?.notifyChanged?.();
    },
    error: (id: string, message: string) => {
      const aiComParams = this.getAiComParams(id);
      if (!aiComParams?.data) return;
      aiComParams.data.generate = true;
      aiComParams.data.generateError = true;
      aiComParams.data.generateErrorMessage = message ?? '';
      this.getAiCom(id)?.actions?.notifyChanged?.();
    },
    end: (id: string) => {
      const aiComParams = this.getAiComParams(id);
      if (!aiComParams?.data) return;
      delete aiComParams.data.generate;
      delete aiComParams.data.generateFileName;
      delete aiComParams.data.generateContent;
      delete aiComParams.data.generateError;
      delete aiComParams.data.generateErrorMessage;
      this.getAiCom(id)?.actions?.notifyChanged?.();
    },
  };

  updateFile(id, { fileName, content }) {
    const aiComParams = this.getAiComParams(id);

    switch (fileName) {
      case "model.json":
        aiComParams.data.modelConfig = encodeURIComponent(content);
        break;
      case "runtime.jsx":
        updateRender({
          data: aiComParams.data,
          success: () => {
            const aiCom = this.getAiCom(id);
            aiCom?.actions?.notifyChanged?.();
          }},
          content
        );
        break;
      case "style.less":
        updateStyle({
          id,
          data: aiComParams.data,
          success: () => {
            this.getAiCom(id)?.actions?.notifyChanged?.();
          },
        }, content);
        break;
      case "config.js":
        aiComParams.data.configJsCompiled = encodeURIComponent(content);
        aiComParams.data.configJsSource = encodeURIComponent(content);
        break;
      case "store.js":
        updateStore({
          data: aiComParams.data,
          success: () => {
            this.getAiCom(id)?.actions?.notifyChanged?.();
          },
        }, content);
        break;
      case "service.js":
        updateService({
          data: aiComParams.data,
          success: () => {
            this.getAiCom(id)?.actions?.notifyChanged?.();
          },
        }, content);
        break;
      case "com.json":
        aiComParams.data.componentConfig = encodeURIComponent(content);
        const oriInputs = aiComParams.input.get();
        const oriOutputs = aiComParams.output.get();
        let parsed: { title?: string; inputs?: unknown[]; outputs?: unknown[] };
        try {
          parsed = JSON.parse(content);
        } catch {
          break;
        }
        const title = parsed?.title;
        const inputs = Array.isArray(parsed?.inputs) ? parsed.inputs : [];
        const outputs = Array.isArray(parsed?.outputs) ? parsed.outputs : [];

        inputs.forEach((item: any) => {
          const { id, title, desc, schema } = item ?? {};
          if (id == null) return;
          const oriInputIndex = oriInputs.findIndex((input) => input.id === id);
          if (oriInputIndex !== - 1) {
            // 修改
            const oriInput = oriInputs[oriInputIndex];
            oriInput.setTitle(title);
            oriInput.setSchema(schema);
            oriInputs.splice(oriInputIndex, 1)
          } else {
            // 新增
            aiComParams.input.add({
              id,
              title,
              desc,
              schema,
            });
          }
        })

        oriInputs.forEach((input) => {
          aiComParams.input.remove(input.id);
        })

        outputs.forEach((item: any) => {
          const { id, title, desc, schema } = item ?? {};
          if (id == null) return;
          const oriOutputIndex = oriOutputs.findIndex((output) => output.id === id);
          if (oriOutputIndex !== - 1) {
            // 修改
            const oriOutput = oriOutputs[oriOutputIndex];
            oriOutput.setTitle(title);
            oriOutput.setSchema(schema);
            oriOutputs.splice(oriOutputIndex, 1)
          } else {
            // 新增
            aiComParams.output.add({
              id,
              title,
              desc,
              schema,
            });
          }
        })

        oriOutputs.forEach((output) => {
          aiComParams.output.remove(output.id);
        })

        if (title) {
          aiComParams?.setTitle?.(title);
        }
        break;
      default:
        break;
    }
  }
}

export default new Context();
