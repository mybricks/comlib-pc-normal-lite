import { toDataSetKey } from './utils';

type ReactNativeBinding = {
  kind: "component" | "namespace";
  importedName?: string;
};

function isInternalOrLocalSource(source: string) {
  return (
    !source ||
    source === "html" ||
    source === "mybricks" ||
    source === "react-native" ||
    source.startsWith("react-native/") ||
    source.startsWith(".") ||
    source.startsWith("/") ||
    source.startsWith("@mybricks/")
  );
}

function isReactNativeSource(source: string | null | undefined) {
  return typeof source === "string" && (source === "react-native" || source.startsWith("react-native/"));
}

function isThirdPartySource(source: string) {
  return !isInternalOrLocalSource(source);
}

function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node));
}

function createReactCreateElementCallee() {
  return {
    type: "MemberExpression",
    object: { type: "Identifier", name: "React" },
    property: { type: "Identifier", name: "createElement" },
    computed: false,
  };
}

function createReactCreateElementCall(tag: any, props: any, children: any[] = []) {
  return {
    type: "CallExpression",
    callee: createReactCreateElementCallee(),
    arguments: [tag, props, ...children],
    leadingComments: [{ type: "CommentBlock", value: "#__PURE__" }],
  };
}

function isReactCreateElementCall(node: any) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "React" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "createElement"
  );
}

function getRootIdentifierName(node: any): string | null {
  if (!node) return null;

  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "MemberExpression") {
    return getRootIdentifierName(node.object);
  }

  return null;
}

function createRequireCall(source: string) {
  return {
    type: "CallExpression",
    callee: { type: "Identifier", name: "require" },
    arguments: [createStringLiteral(source)],
  };
}

function getJSXRuntimeTagSource(tag: any, importRelyMap: Map<string, string>) {
  if (!tag || tag.type === "StringLiteral") {
    return "html";
  }

  if (tag.type === "Identifier") {
    return importRelyMap.get(tag.name) || "html";
  }

  if (tag.type === "MemberExpression") {
    const rootName = getRootIdentifierName(tag);
    return rootName ? importRelyMap.get(rootName) || "html" : "html";
  }

  return "html";
}

function collectReactNativeImportDeclaration(path: any, reactNativeBindingMap: Map<string, ReactNativeBinding>) {
  const source = path.node.source?.value;
  if (!isReactNativeSource(source)) return;

  for (const specifier of path.node.specifiers || []) {
    const localName = specifier.local?.name;
    if (!localName) continue;

    if (specifier.type === "ImportSpecifier") {
      const importedName = specifier.imported?.type === "Identifier"
        ? specifier.imported.name
        : specifier.imported?.type === "StringLiteral"
          ? specifier.imported.value
          : localName;
      reactNativeBindingMap.set(localName, { kind: "component", importedName });
      continue;
    }

    if (specifier.type === "ImportNamespaceSpecifier") {
      reactNativeBindingMap.set(localName, { kind: "namespace" });
    }
  }
}

function getObjectPropertyName(property: any): string | null {
  const key = property?.key;
  if (!key) return null;

  if (key.type === "Identifier") {
    return key.name;
  }

  if (key.type === "StringLiteral") {
    return key.value;
  }

  return null;
}

function isDataObjectProperty(property: any) {
  return (
    property?.type === "ObjectProperty" &&
    typeof getObjectPropertyName(property) === "string" &&
    getObjectPropertyName(property)!.startsWith("data-")
  );
}

function getDataObjectProperties(props: any) {
  if (props?.type !== "ObjectExpression") {
    return [];
  }

  return props.properties.filter(isDataObjectProperty).map(cloneNode);
}

function createStringLiteral(value: string) {
  return {
    type: "StringLiteral",
    value,
    extra: { raw: `"${value}"`, rawValue: value },
  };
}

function cloneDataPropertyAsDataSet(property: any) {
  const keyName = getObjectPropertyName(property);
  if (!keyName) return null;

  return {
    type: "ObjectProperty",
    key: { type: "Identifier", name: toDataSetKey(keyName) },
    value: cloneNode(property.value),
    computed: false,
    shorthand: false,
  };
}

function getDataSetValueExpression(props: any) {
  const dataSetProperties: any[] = [];

  let dataSetExpression: any | null = null;

  if (props?.type === "ObjectExpression") {
    for (const property of props.properties || []) {
      if (property?.type !== "ObjectProperty") continue;
      const keyName = getObjectPropertyName(property);
      if (!keyName) continue;

      if (keyName === "dataSet") {
        if (property.value?.type === "ObjectExpression") {
          for (const nestedProperty of property.value.properties || []) {
            if (nestedProperty?.type !== "ObjectProperty") continue;
            const nestedKeyName = getObjectPropertyName(nestedProperty);
            if (nestedKeyName === 'wrapContainer') continue;
            dataSetProperties.push(cloneNode(nestedProperty));
          }
        } else if (property.value) {
          dataSetExpression = cloneNode(property.value);
        }
        continue;
      }

      if (!keyName.startsWith("data-")) continue;
      if (toDataSetKey(keyName) === 'wrapContainer') continue;
      const dataSetProperty = cloneDataPropertyAsDataSet(property);
      if (dataSetProperty) {
        dataSetProperties.push(dataSetProperty);
      }
    }
  }

  dataSetProperties.push({
    type: "ObjectProperty",
    key: { type: "Identifier", name: "wrapContainer" },
    value: createStringLiteral("true"),
    computed: false,
    shorthand: false,
  });

  const objectExpression = {
    type: "ObjectExpression",
    properties: dataSetProperties,
  };

  if (!dataSetExpression) {
    return objectExpression;
  }

  return {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Object" },
      property: { type: "Identifier", name: "assign" },
      computed: false,
    },
    arguments: [
      { type: "ObjectExpression", properties: [] },
      dataSetExpression,
      objectExpression,
    ],
  };
}

function createDisplayContentsProps(originalProps: any) {
  return {
    type: "ObjectExpression",
    properties: [
      {
        type: "ObjectProperty",
        key: { type: "Identifier", name: "style" },
        value: {
          type: "ObjectExpression",
          properties: [
            {
              type: "ObjectProperty",
              key: { type: "Identifier", name: "display" },
              value: { type: "StringLiteral", value: "contents" },
              computed: false,
              shorthand: false,
            },
          ],
        },
        computed: false,
        shorthand: false,
      },
      ...getDataObjectProperties(originalProps),
      // Mark this wrapper div so refSelector queries can exclude it via :not([data-wrap-container])
      {
        type: "ObjectProperty",
        key: { type: "StringLiteral", value: "data-wrap-container" },
        value: { type: "StringLiteral", value: "true" },
        computed: false,
        shorthand: false,
      },
    ],
  };
}

function createDisplayContentsDataSetProps(originalProps: any) {
  return {
    type: "ObjectExpression",
    properties: [
      {
        type: "ObjectProperty",
        key: { type: "Identifier", name: "style" },
        value: {
          type: "ObjectExpression",
          properties: [
            {
              type: "ObjectProperty",
              key: { type: "Identifier", name: "display" },
              value: { type: "StringLiteral", value: "contents" },
              computed: false,
              shorthand: false,
            },
          ],
        },
        computed: false,
        shorthand: false,
      },
      {
        type: "ObjectProperty",
        key: { type: "Identifier", name: "dataSet" },
        value: getDataSetValueExpression(originalProps),
        computed: false,
        shorthand: false,
      },
    ],
  };
}

function createRequireSourceFromExpression(expression: any): string | null {
  if (
    expression?.type === "CallExpression" &&
    expression.callee?.type === "Identifier" &&
    expression.callee.name === "require" &&
    expression.arguments?.[0]?.type === "StringLiteral"
  ) {
    return expression.arguments[0].value;
  }

  if (
    expression?.type === "CallExpression" &&
    expression.arguments?.[0]
  ) {
    return createRequireSourceFromExpression(expression.arguments[0]);
  }

  if (expression?.type === "MemberExpression" && expression.object) {
    return createRequireSourceFromExpression(expression.object);
  }

  return null;
}

function collectImportDeclaration(path: any, importRelyMap: Map<string, string>) {
  const source = path.node.source?.value;
  if (typeof source !== "string") return;

  for (const specifier of path.node.specifiers || []) {
    const localName = specifier.local?.name;
    if (localName) {
      importRelyMap.set(localName, source);
    }
  }
}

function collectVariableDeclarator(path: any, importRelyMap: Map<string, string>) {
  const { id, init } = path.node;

  if (id?.type === "Identifier") {
    const requireSource = createRequireSourceFromExpression(init);
    if (requireSource) {
      importRelyMap.set(id.name, requireSource);
      return;
    }
  }

  if (id?.type === "ObjectPattern") {
    const requireSource = createRequireSourceFromExpression(init);
    if (!requireSource) return;

    for (const property of id.properties || []) {
      if (property?.type !== "ObjectProperty") continue;
      const localName = property.value?.type === "Identifier" ? property.value.name : null;
      if (localName) {
        importRelyMap.set(localName, requireSource);
      }
    }
    return;
  }

  if (
    id?.type === "Identifier" &&
    init?.type === "MemberExpression" &&
    init.object?.type === "Identifier"
  ) {
    importRelyMap.set(id.name, init.object.name);
  }
}

function collectReactNativeVariableDeclarator(path: any, reactNativeBindingMap: Map<string, ReactNativeBinding>) {
  const { id, init } = path.node;
  const requireSource = createRequireSourceFromExpression(init);
  if (!isReactNativeSource(requireSource)) return;

  if (id?.type === "Identifier") {
    if (init?.type === "MemberExpression" && init.property?.type === "Identifier") {
      reactNativeBindingMap.set(id.name, { kind: "component", importedName: init.property.name });
      return;
    }

    reactNativeBindingMap.set(id.name, { kind: "namespace" });
    return;
  }

  if (id?.type === "ObjectPattern") {
    for (const property of id.properties || []) {
      if (property?.type !== "ObjectProperty") continue;
      const localName = property.value?.type === "Identifier" ? property.value.name : null;
      if (!localName) continue;

      const importedName = property.key?.type === "Identifier"
        ? property.key.name
        : property.key?.type === "StringLiteral"
          ? property.key.value
          : localName;
      reactNativeBindingMap.set(localName, { kind: "component", importedName });
    }
  }
}

function getReactNativeViewLocalName(reactNativeBindingMap: Map<string, ReactNativeBinding>) {
  for (const [localName, binding] of reactNativeBindingMap.entries()) {
    if (binding.kind === "component" && binding.importedName === "View") {
      return localName;
    }
  }

  return null;
}

function createReactNativeViewBindingDeclaration(localName: string) {
  return {
    type: "VariableDeclaration",
    kind: "const",
    declarations: [
      {
        type: "VariableDeclarator",
        id: { type: "Identifier", name: localName },
        init: {
          type: "MemberExpression",
          object: createRequireCall("react-native"),
          property: { type: "Identifier", name: "View" },
          computed: false,
        },
      },
    ],
  };
}

function insertAfterImports(body: any[], node: any) {
  let insertIndex = 0;
  while (insertIndex < body.length && body[insertIndex]?.type === "ImportDeclaration") {
    insertIndex += 1;
  }
  body.splice(insertIndex, 0, node);
}

function ensureReactNativeViewLocalName(path: any, reactNativeBindingMap: Map<string, ReactNativeBinding>) {
  const existingLocalName = getReactNativeViewLocalName(reactNativeBindingMap);
  if (existingLocalName) {
    return existingLocalName;
  }

  const localName = path.scope.generateUidIdentifier("View").name;
  insertAfterImports(path.node.body, createReactNativeViewBindingDeclaration(localName));
  reactNativeBindingMap.set(localName, { kind: "component", importedName: "View" });
  return localName;
}

function wrapCreateElementCall(path: any, importRelyMap: Map<string, string>, reactNative: boolean, reactNativeViewLocalName: string | null) {
  const node = path.node;
  if (!isReactCreateElementCall(node)) return;

  const [tag, props] = node.arguments || [];
  const source = getJSXRuntimeTagSource(tag, importRelyMap);
  if (!isThirdPartySource(source)) return;

  const wrapperTag = reactNative
    ? { type: "Identifier", name: reactNativeViewLocalName || "View" }
    : { type: "StringLiteral", value: "div" };

  path.replaceWith(
    createReactCreateElementCall(
      wrapperTag,
      reactNative ? createDisplayContentsDataSetProps(props) : createDisplayContentsProps(props),
      [cloneNode(node)],
    ),
  );
  path.skip();
}

export default function wrapThirdPartyPlugin({ reactNative = false }: { reactNative?: boolean } = {}) {
  return function () {
    let importRelyMap: Map<string, string>;
    let reactNativeBindingMap: Map<string, ReactNativeBinding>;
    let reactNativeViewLocalName: string | null = null;

    return {
      pre() {
        importRelyMap = new Map();
        reactNativeBindingMap = new Map();
        reactNativeViewLocalName = null;
      },
      visitor: {
        ImportDeclaration(path) {
          collectImportDeclaration(path, importRelyMap);
          collectReactNativeImportDeclaration(path, reactNativeBindingMap);
        },
        VariableDeclarator(path) {
          collectVariableDeclarator(path, importRelyMap);
          collectReactNativeVariableDeclarator(path, reactNativeBindingMap);
        },
        Program: {
          exit(path) {
            if (reactNative) {
              reactNativeViewLocalName = ensureReactNativeViewLocalName(path, reactNativeBindingMap);
            }

            path.traverse({
              VariableDeclarator(variablePath) {
                collectVariableDeclarator(variablePath, importRelyMap);
                collectReactNativeVariableDeclarator(variablePath, reactNativeBindingMap);
              },
              CallExpression: {
                exit(callPath) {
                  wrapCreateElementCall(callPath, importRelyMap, reactNative, reactNativeViewLocalName);
                },
              },
            });
          },
        },
      },
    };
  };
}
