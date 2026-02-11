import * as React from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from "echarts";


const ReactEcharts = (props) => {
  return <ReactEChartsCore {...props} echarts={echarts} />
}

function createSelfReferencingFunction() {
  const handler = {
    get(target, prop, receiver) {
      // 当访问属性时，返回函数自身
      return target;
    },
    apply(target, thisArg, argumentsList) {
      // 当调用函数时，执行实际的函数逻辑
      return target.apply(thisArg, argumentsList);
    }
  };
  return new Proxy(ReactEcharts, handler);
}

export default createSelfReferencingFunction();