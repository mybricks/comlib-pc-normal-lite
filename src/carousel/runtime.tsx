import React from 'react';
import { Carousel } from 'antd';
import styles from './runtime.less';

export interface Data {
  items: any[];
  autoplay: boolean;
  autoplaySpeed: number;
  bgSize: string;
}

export default ({ data, slots }: RuntimeParams<Data>) => {
  return (
    <div className={styles.carouselWrapper}>
      <Carousel>
        {data.items.map((item, index) => (
          <div className={styles.item} key={index}>
            <div
              className={styles.itemSlotContainer}
              style={{
                background: item.url ? `url(${item.url}) no-repeat center center` : undefined,
                backgroundSize: item.bgSize || 'contain',
                backgroundColor: item.bgColor?.background
              }}
            >
              {item.slotId && slots[item.slotId]?.render()}
            </div>
          </div>
        ))}
      </Carousel>
    </div>
  );
};