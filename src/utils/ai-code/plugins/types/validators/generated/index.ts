import shallowEqual from "../../utils/shallowEqual"

export function isIdentifier(node, opts?) {
  if (!node) return false;

  if (node.type !== "Identifier") return false;

  return opts == null || shallowEqual(node, opts);
}

export function isImportSpecifier(node, opts?) {
  if (!node) return false;

  if (node.type !== "ImportSpecifier") return false;

  return opts == null || shallowEqual(node, opts);
}


export function isMemberExpression(node, opts?) {
  if (!node) return false;

  if (node.type !== "MemberExpression") return false;

  return opts == null || shallowEqual(node, opts);
}