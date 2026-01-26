import React, { useCallback } from 'react';

import css from './runtime.less';

export default function ({ env, data, outputs }) {
  const onClick = useCallback(() => {
    if (env.runtime) {
      outputs['click']();
    }
  }, []);

  const onDoubleClick = useCallback(() => {
    if (env.runtime) {
      outputs['dblClick']();
    }
  }, []);

  return (
    <div
      className={css.button}
      style={data.style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}>
      {data.text}
    </div>
  );
}
