function isInternalOrLocalSource(source: string) {
  return (
    !source ||
    source === "html" ||
    source === "mybricks" ||
    source.startsWith(".") ||
    source.startsWith("/") ||
    source.startsWith("@mybricks/")
  );
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
      // Mark this wrapper div so refSelector queries can exclude it via :not([data-wrap-container])
      {
        type: "ObjectProperty",
        key: { type: "StringLiteral", value: "data-wrap-container" },
        value: { type: "StringLiteral", value: "true" },
        computed: false,
        shorthand: false,
      },
      ...getDataObjectProperties(originalProps),
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

function wrapCreateElementCall(path: any, importRelyMap: Map<string, string>) {
  const node = path.node;
  if (!isReactCreateElementCall(node)) return;

  const [tag, props] = node.arguments || [];
  const source = getJSXRuntimeTagSource(tag, importRelyMap);
  if (!isThirdPartySource(source)) return;

  path.replaceWith(
    createReactCreateElementCall(
      { type: "StringLiteral", value: "div" },
      createDisplayContentsProps(props),
      [cloneNode(node)],
    ),
  );
  path.skip();
}

export default function wrapThirdPartyPlugin() {
  return function () {
    let importRelyMap: Map<string, string>;

    return {
      pre() {
        importRelyMap = new Map();
      },
      visitor: {
        ImportDeclaration(path) {
          collectImportDeclaration(path, importRelyMap);
        },
        VariableDeclarator(path) {
          collectVariableDeclarator(path, importRelyMap);
        },
        Program: {
          exit(path) {
            path.traverse({
              VariableDeclarator(variablePath) {
                collectVariableDeclarator(variablePath, importRelyMap);
              },
              CallExpression(callPath) {
                wrapCreateElementCall(callPath, importRelyMap);
              },
            });
          },
        },
      },
    };
  };
}
