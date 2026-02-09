// 根据 id 或 comName 查找表单项
const getFormItem = (data, { id, name }) => {
  return data.items?.find((item) => {
    if (item.comName) {
      return item.comName === name;
    }
    return item.id === id;
  });
};

export default {
  '@resize': {
    options: ['width', 'height']
  },
  '@init': ({ style }) => {
    style.width = '100%';
    style.height = 'auto';
  },
  // 当子组件被添加到插槽时
  '@childAdd'({ data }, child, curSlot) {
    if (curSlot.id === 'content') {
      const { id, name } = child;
      const exists = getFormItem(data, { id, name });
      if (!exists) {
        const count = data.items?.length || 0;
        data.items = data.items || [];
        data.items.push({
          id,
          comName: name,
          name: `field${count}`,
          label: `表单项${count}`
        });
      }
    }
  },
  // 当子组件被移除时
  '@childRemove'({ data }, child) {
    const idx = data.items?.findIndex(
      (item) => item.id === child.id || item.comName === child.name
    );
    if (idx !== -1 && idx !== undefined) {
      data.items.splice(idx, 1);
    }
  },
  ':slot': {},
  ':root': {
    items: [
      {
        title: '每行列数',
        type: 'Slider',
        options: {
          max: 4,
          min: 1,
          step: 1,
          formatter: '列/行'
        },
        value: {
          get({ data }) {
            return data.formItemColumn || 1;
          },
          set({ data }, value) {
            data.formItemColumn = value;
          }
        }
      }
    ]
  },
  // 表单项编辑器 - 选中插槽内的子组件时显示
  ':child(mybricks.normal-pc-lite.form-container/form-item)': {
    title: '表单项',
    items: [
      {
        title: '标题',
        type: 'text',
        value: {
          get({ id, name, data }) {
            const item = getFormItem(data, { id, name });
            return item?.label;
          },
          set({ id, name, data }, val) {
            const item = getFormItem(data, { id, name });
            if (item) {
              item.label = val;
            }
          }
        }
      },
      {
        title: '字段名',
        type: 'text',
        value: {
          get({ id, name, data }) {
            const item = getFormItem(data, { id, name });
            return item?.name;
          },
          set({ id, name, data }, val) {
            const item = getFormItem(data, { id, name });
            if (item) {
              item.name = val;
            }
          }
        }
      }
    ]
  }
};
