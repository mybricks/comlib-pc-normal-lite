import { ImageProps } from "antd";
import { getPropsFromObject } from "../utils/toReact";
import { Data } from "./constants";

export default function ({ data }: RuntimeParams<Data>) {

    const str = getSingleImageStr({ data });

    return {
        imports: [
            {
                from: 'antd',
                coms: ['Image']
            },
            {
                from: 'antd/dist/antd.css',
                coms: []
            },
        ],
        jsx: str,
        style: '',
        js: ''
    }
}

/**
 * 获取图片codeStr
 * @param env 
 */
const getSingleImageStr = ({ data }: { data: Data }) => {
    const { src, customStyle } = data;
    const { styleEditorUnfold, ...style } = customStyle || {};

    const imageProps: ImageProps = {
        src,
        width: '100%',
        height: '100%',
        style,
    };

    return `<Image
                ${getPropsFromObject(imageProps)}
            />`
}