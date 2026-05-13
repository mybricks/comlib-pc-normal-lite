const get = (obj: Record<string, unknown>, key: string) => obj[key];
const has = (obj: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const find = <T>(arr: T[], predicate: (item: T) => boolean): T | undefined => arr.find(predicate);

const OBJECT_VALUES = {
  "process.env.POPUP_VISIBLE": false,
  "process.env.POPUP_NODE": null,
}
const OBJECT_PATHS = Object.keys(OBJECT_VALUES)

/**
 * Replace a node with a given value. If the replacement results in a BinaryExpression, it will be
 * evaluated. For example, if the result of the replacement is `var x = "production" === "production"`
 * The evaluation will make a second replacement resulting in `var x = true`
 * @param  {function}   replaceFn    The function used to replace the node
 * @param  {babelNode}  nodePath     The node to evaluate
 * @param  {*}          replacement  The value the node will be replaced with
 * @return {undefined}
 */
const replaceAndEvaluateNode = (replaceFn, nodePath, replacement) => {
  nodePath.replaceWith(replaceFn(replacement));

  // Evaluate BinaryExpression: e.g. "production" === "production" → true
  if (nodePath.parentPath.isBinaryExpression()) {
    const result = nodePath.parentPath.evaluate();
    if (result.confident) {
      nodePath.parentPath.replaceWith(replaceFn(result.value));
    }
  }

  // Simplify LogicalExpression: false || x → x, true || x → true, true && x → x, false && x → false
  if (nodePath.parentPath.isLogicalExpression()) {
    const logical = nodePath.parentPath;
    const { operator, left, right } = logical.node;
    const leftResult = logical.get('left').evaluate();
    if (leftResult.confident) {
      const leftVal = leftResult.value;
      if (operator === '||') {
        if (!leftVal) {
          logical.replaceWith(right);
        } else {
          logical.replaceWith(left);
        }
      } else if (operator === '&&') {
        if (leftVal) {
          logical.replaceWith(right);
        } else {
          logical.replaceWith(left);
        }
      }
    }
  }

  // Remove dead if/else branches: if (false) { ... } → remove; if (true) { ... } → keep consequent
  if (nodePath.parentPath.isIfStatement()) {
    const ifPath = nodePath.parentPath;
    const testResult = ifPath.get('test').evaluate();
    if (testResult.confident) {
      if (!testResult.value) {
        // condition is always false: remove the if, keep alternate if present
        if (ifPath.node.alternate) {
          ifPath.replaceWith(ifPath.node.alternate);
        } else {
          ifPath.remove();
        }
      } else {
        // condition is always true: replace with consequent body
        ifPath.replaceWith(ifPath.node.consequent);
      }
    }
  }
};

/**
 * Finds the first replacement in sorted object paths for replacements that causes comparator
 * to return true.  If one is found, replaces the node with it.
 * @param  {Object}     replacements The object to search for replacements
 * @param  {babelNode}  nodePath     The node to evaluate
 * @param  {function}   replaceFn    The function used to replace the node
 * @param  {function}   comparator   The function used to evaluate whether a node matches a value in `replacements`
 * @return {undefined}
 */
// eslint-disable-next-line max-params
const processNode = (replacements, nodePath, replaceFn, comparator) => {
  const replacementKey = find(OBJECT_PATHS,
    (value) => comparator(nodePath, value));
  if (replacementKey !== undefined && has(replacements, replacementKey)) {
    replaceAndEvaluateNode(replaceFn, nodePath, get(replacements, replacementKey));
  }
};

const memberExpressionComparator = (nodePath, value) => nodePath.matchesPattern(value);

const plugin = function ({ types: t }) {
  return {
    visitor: {
      MemberExpression(nodePath) {
        processNode(OBJECT_VALUES, nodePath, t.valueToNode, memberExpressionComparator);
      },
    }
  };
};

export default plugin;
