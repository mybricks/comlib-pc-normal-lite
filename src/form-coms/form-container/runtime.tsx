import { Form, Row, Col } from 'antd';
import React from 'react';

export default function ({ data, slots, env }) {
  // 根据组件 id 或 comName 查找对应的表单项配置
  const getFormItem = (com: { id: string; name: string }) => {
    return data.items?.find((item) => {
      if (item.comName) {
        return item.comName === com.name;
      }
      return item.id === com.id;
    });
  };

  // 计算每列占用的栅格数（共24格）
  const colSpan = 24 / (data.formItemColumn || 1);

  // 编辑模式下，使用 key 强制刷新插槽内容
  const slotKey = env.edit ? data.formItemColumn : undefined;

  return (
    <Form>
      {slots['content']?.render({
        key: slotKey,
        itemWrap(com) {
          const item = getFormItem(com);
          return (
            <Form.Item label={item?.label} name={item?.name}>
              {com.jsx}
            </Form.Item>
          );
        },
        wrap(comArray) {
          // wrap 函数处理整体布局，将所有表单项放入 Row/Col 栅格中
          return (
            <Row gutter={16}>
              {comArray?.map((com) => (
                <Col key={com.id} span={colSpan}>
                  {com.jsx}
                </Col>
              ))}
            </Row>
          );
        }
      })}
    </Form>
  );
}
