import { useMemo } from "react";
import { replaceToUnderline } from "./utils";

const STYLE_REPLACE_ID = '__mybricks_ai_module_id__';

const useCssApi = ({ id, env }) => {
  return useMemo(() => {
    const cssAPI = env.canvas.css
    return {
      set(props: { content: string, fileName: string }) {
        const { content, fileName } = props;
        const myContent = content.replaceAll(STYLE_REPLACE_ID, id)

        cssAPI.set(replaceToUnderline(`${id}_${fileName}`), myContent)
      },
      remove() {
        return cssAPI.remove(id)
      }
    }
  }, [])
}

export { useCssApi }
