import React from 'react';
import { applyRawSvg } from '../../styleProxy';
import styles from './style.less';
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
      className={styles.iconItem}
      title={icon.name}
      onClick={() => {
        applyRawSvg(params, icon.svg);
        onClose();
      }}
    >
      <div className={styles.iconItemSvg} dangerouslySetInnerHTML={{ __html: icon.svg }} />
      <span className={styles.iconItemName}>{icon.name}</span>
    </button>
  );
}
