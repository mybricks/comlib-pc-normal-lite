import React, { useEffect } from 'react';

interface Data {
  content: string;
  style?: React.CSSProperties;
}

export default function ({ data, inputs, outputs, env }: RuntimeParams<Data>) {
  useEffect(() => {
    inputs['content']((value: string, relOutputs) => {
      let res = value;
      if (res !== undefined && typeof res !== 'string') {
        res = JSON.stringify(res);
      }
      data.content = res;
      if (relOutputs && relOutputs['setContentDone']) {
        relOutputs['setContentDone'](res);
      }
    });
  }, []);

  const handleClick = () => {
    if (outputs && outputs['click']) {
      outputs['click'](data.content || '');
    }
  };

  return (
    <div
      style={{
        ...data.style,
        cursor: outputs && outputs['click'] ? 'pointer' : 'default'
      }}
      onClick={handleClick}
    >
      {env?.i18n ? env.i18n(data.content || '') : data.content || ''}
    </div>
  );
}
