import genVibeCodingAgent from "../agent/vibeCoding";
import { updateRender, updateStyle } from "../../utils/ai-code/transform-umd";

class Context {
  aiComParamsMap: Record<string, any> = {};

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

  updateFile(id, { fileName, content }) {
    const aiComParams = this.getAiComParams(id);

    switch (fileName) {
      case "model.json":
        aiComParams.data.modelConfig = encodeURIComponent(content);
        break;
      case "runtime.jsx":
        updateRender({ data: aiComParams.data }, content);
        const aiCom = this.getAiCom(id);
        aiCom?.actions?.notifyChanged?.();
        break;
      case "style.less":
        updateStyle({ id, data: aiComParams.data }, content);
        break;
      case "config.js":
        aiComParams.data.configJsCompiled = encodeURIComponent(content);
        aiComParams.data.configJsSource = encodeURIComponent(content);
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
