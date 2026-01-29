import { RadioGroupProps } from 'antd';

export interface Data {
  config: RadioGroupProps;
  rules: any[];
  value: number | string | undefined;
  staticOptions: any[];
  enableButtonStyle: boolean;
  autoBreakLine?: boolean;
  buttonStyle: 'outline' | 'solid';
  layout: 'vertical' | 'horizontal';
  isEditable: boolean;
  autoFocus: false | 'first' | 'defaultCheck';
}
