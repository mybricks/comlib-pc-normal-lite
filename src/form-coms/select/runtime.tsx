import React, { useCallback, useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Select, Spin } from 'antd';
import css from './runtime.less';

export default function Runtime({
  env,
  data,
  id,
}) {

  return (
    <div className={`${css.select} ${css.selectColor} ${ANTD_VERSION === 5 ? css.antd5Select : ''}`} id="area">
        <Select
          placeholder={env.i18n(data.config.placeholder)}
          labelInValue={false}
        >
        </Select>
    </div>
  );
}
