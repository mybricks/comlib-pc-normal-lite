/**
 * 向 JSX 元素的 attributes 中追加 data-xxx 属性（字符串值）
 */
export type DataAttrMode = 'web' | 'react-native';

export type DataAttrOptions = {
  mode?: DataAttrMode;
};

function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node));
}

function createStringLiteral(value: string) {
  return {
    type: "StringLiteral",
    value,
    extra: { raw: JSON.stringify(value), rawValue: value },
  };
}

function createNumericLiteral(value: number) {
  return {
    type: "NumericLiteral",
    value,
    extra: { raw: String(value), rawValue: value },
  };
}

function escapeTemplateRaw(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function createTemplateLiteral(value: string) {
  return {
    type: "TemplateLiteral",
    quasis: [
      {
        type: "TemplateElement",
        value: {
          raw: escapeTemplateRaw(value),
          cooked: value,
        },
        tail: true,
      },
    ],
    expressions: [],
  };
}

function createJSXExpressionContainer(expression: any) {
  return {
    type: "JSXExpressionContainer",
    expression,
  };
}

function isValidIdentifierName(name: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function toCamelCase(name: string) {
  const raw = name.startsWith('data-') ? name.slice(5) : name;
  return raw
    .split('-')
    .filter(Boolean)
    .map((segment, index) => {
      if (index === 0) return segment;
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join('');
}

export function toDataSetKey(name: string) {
  return toCamelCase(name);
}

function createObjectProperty(name: string, value: any) {
  return {
    type: "ObjectProperty",
    key: isValidIdentifierName(name)
      ? { type: "Identifier", name }
      : { type: "StringLiteral", value: name },
    value,
    computed: false,
    shorthand: false,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function toExpressionNode(value: any, useTemplateLiteral = false): any {
  if (value && typeof value === 'object' && typeof value.type === 'string') {
    return cloneNode(value);
  }

  if (value === null) {
    return { type: 'NullLiteral' };
  }

  if (Array.isArray(value)) {
    return {
      type: 'ArrayExpression',
      elements: value.map((item) => toExpressionNode(item, useTemplateLiteral)),
    };
  }

  switch (typeof value) {
    case 'string':
      return useTemplateLiteral ? createTemplateLiteral(value) : createStringLiteral(value);
    case 'number':
      return createNumericLiteral(value);
    case 'boolean':
      return {
        type: 'BooleanLiteral',
        value,
      };
    case 'undefined':
      return { type: 'Identifier', name: 'undefined' };
    case 'object':
      if (isPlainObject(value)) {
        return {
          type: 'ObjectExpression',
          properties: Object.entries(value).map(([key, childValue]) =>
            createObjectProperty(key, toExpressionNode(childValue, useTemplateLiteral))
          ),
        };
      }
      return createStringLiteral(String(value));
    default:
      return createStringLiteral(String(value));
  }
}

function findDataSetAttribute(attributes: any[]) {
  return attributes.find(
    (attr) => attr?.type === 'JSXAttribute' && attr.name?.name === 'dataSet'
  );
}

function getDataSetObjectExpression(attributes: any[]) {
  const dataSetAttr = findDataSetAttribute(attributes);
  const dataSetValue = dataSetAttr?.value;

  if (
    dataSetValue?.type === 'JSXExpressionContainer' &&
    dataSetValue.expression?.type === 'ObjectExpression'
  ) {
    return dataSetValue.expression;
  }

  if (dataSetAttr) {
    const existingValue = dataSetValue?.type === 'JSXExpressionContainer'
      ? dataSetValue.expression
      : dataSetValue;

    const objectExpression = {
      type: "ObjectExpression",
      properties: existingValue
        ? [{
          type: 'SpreadElement',
          argument: cloneNode(existingValue),
        }]
        : [],
    };

    dataSetAttr.value = createJSXExpressionContainer(objectExpression);
    return objectExpression;
  }

  const objectExpression = {
    type: "ObjectExpression",
    properties: [],
  };

  attributes.push({
    type: "JSXAttribute",
    name: { type: "JSXIdentifier", name: "dataSet" },
    value: createJSXExpressionContainer(objectExpression),
  });

  return objectExpression;
}

function upsertDataSetAttribute(attributes: any[], name: string, value: any) {
  const dataSetObjectExpression = getDataSetObjectExpression(attributes);
  const dataSetKey = toDataSetKey(name);
  const properties = dataSetObjectExpression.properties || [];
  const existingProperty = properties.find((property: any) => {
    if (property?.type !== 'ObjectProperty') return false;
    if (property.key?.type === 'Identifier') {
      return property.key.name === dataSetKey;
    }
    if (property.key?.type === 'StringLiteral') {
      return property.key.value === dataSetKey;
    }
    return false;
  });

  if (existingProperty) {
    existingProperty.value = toExpressionNode(value, true);
    return;
  }

  properties.push(createObjectProperty(dataSetKey, toExpressionNode(value, true)));
  dataSetObjectExpression.properties = properties;
}

export function pushDataAttr(attributes: any[], name: string, value: any, options: DataAttrOptions = {}) {
  if (options.mode === 'react-native') {
    upsertDataSetAttribute(attributes, name, value);
    return;
  }

  attributes.push({
    type: "JSXAttribute",
    name: { type: "JSXIdentifier", name },
    value: createStringLiteral(value),
  });
}

/**
 * 向 JSX 元素的 attributes 中追加 data-xxx 属性（表达式，如变量名）
 */
export function pushDataAttrExpression(attributes: any[], name: string, identifierName: string, options: DataAttrOptions = {}) {
  if (options.mode === 'react-native') {
    upsertDataSetAttribute(attributes, name, {
      type: "Identifier",
      name: identifierName,
    });
    return;
  }

  attributes.push({
    type: "JSXAttribute",
    name: { type: "JSXIdentifier", name },
    value: {
      type: "JSXExpressionContainer",
      expression: { type: "Identifier", name: identifierName },
    },
  });
}
