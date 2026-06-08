import React from 'react';
import { applyRawSvg } from '../../styleProxy';
import * as styleNS from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';

const css = getLazyCss(styleNS);
import type { DumpIconItem } from './utils';

export default function IconItem({
  icon,
  params,
  onClose,
}: {
  icon: DumpIconItem;
  params: any;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      className={css.iconItem}
      title={icon.name}
      onClick={() => {
        applyRawSvg(params, icon.svg);
        onClose();
      }}
    >
      <div className={css.iconItemSvg} dangerouslySetInnerHTML={{ __html: icon.svg }} />
      <span className={css.iconItemName}>{icon.name}</span>
    </button>
  );
}
