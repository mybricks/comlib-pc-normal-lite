export type DiagramNode = {
  id: string;
  label: string;
  shape: "default" | "round" | "decision";
  depth?: number;
  ui?: UiAnchor[];
  source?: { bind: string };
  field?: { bind: string };
};
export type UiAnchor = { file: string; tag: string; startLine: number; endLine: number };
export type DiagramEdge = {
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
  arrow?: boolean;
};
export type ParsedDiagram = {
  kind: "mindmap" | "flowchart";
  direction: "LR" | "RL" | "TB" | "BT";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

function cleanLabel(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/\s*\r?\n\s*/g, " ")
    .trim();
}

function readUiAnchor(line: string): { id: string; anchor: UiAnchor } | undefined {
  const match = line.trim().match(/^%%\s*@ui\s+([A-Za-z_][\w.-]*)\s+file="([^"\r\n]+)"\s+loc="([A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$]*)*):([1-9]\d*)(?:-([1-9]\d*))?"\s*$/);
  if (!match) return;
  const [, id, file, tag, start, end] = match;
  const startLine = Number(start), endLine = Number(end || start);
  if (/^(?:[\\/]|[A-Za-z]:)/.test(file) || file.split(/[\\/]/).includes('..') || endLine < startLine || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine)) return;
  return { id, anchor: { file, tag, startLine, endLine } };
}

function attachUiAnchors(nodes: DiagramNode[], anchors: Array<{ id: string; anchor: UiAnchor }>) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const { id, anchor } of anchors) {
    const node = byId.get(id);
    if (node) (node.ui ??= []).push(anchor);
  }
}

type DataAnnotation = { id: string; source?: DiagramNode['source']; field?: DiagramNode['field'] };
function readDataAnnotation(line: string): DataAnnotation | undefined {
  const source = line.trim().match(/^%%\s*@source\s+([A-Za-z_][\w.-]*)\s+bind="([^"\r\n]+)"\s*$/);
  if (source) return { id: source[1], source: { bind: source[2] } };
  const item = line.trim().match(/^%%\s*@field\s+([A-Za-z_][\w.-]*)\s+bind="([^"\r\n]+)"\s*$/);
  if (item) return { id: item[1], field: { bind: item[2] } };
}

function attachDataAnnotations(nodes: DiagramNode[], annotations: DataAnnotation[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const annotation of annotations) {
    const node = byId.get(annotation.id);
    if (!node) continue;
    if (annotation.source) node.source = annotation.source;
    if (annotation.field) node.field = annotation.field;
  }
}

function parseMindmap(lines: string[]): ParsedDiagram {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const anchors: Array<{ id: string; anchor: UiAnchor }> = [];
  const annotations: DataAnnotation[] = [];
  const explicitIds = new Set(lines.flatMap(line => {
    const match = line.trim().match(/^([A-Za-z_][\w.-]*)(?=\[|\(|\{)/);
    return match ? [match[1]] : [];
  }));
  const usedIds = new Set<string>();
  const aliases = new Map<string, DiagramNode[]>();
  const stack: Array<{ indent: number; id: string }> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.trim().startsWith("%%")) {
      const anchor = readUiAnchor(line);
      if (anchor) anchors.push(anchor);
      const annotation = readDataAnnotation(line);
      if (annotation) annotations.push(annotation);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
    const text = line.trim();
    if (/^::/.test(text)) throw new Error("Unsupported mindmap decoration");
    const shape = text.match(
      /^([A-Za-z_][\w.-]*)?(?:\(\((.+)\)\)|\[(.+)\]|\((.+)\)|\{\{(.+)\}\})$/,
    );
    const label = cleanLabel(shape ? shape.slice(2).find(Boolean)! : text);
    if (!label) throw new Error("Empty mindmap node");
    while (stack.length && indent <= stack[stack.length - 1].indent)
      stack.pop();
    const explicitId = shape?.[1];
    let id = explicitId || `mind-${nodes.length}`;
    if (!explicitId || usedIds.has(id)) {
      id = explicitId ? `${explicitId}__${nodes.length}` : id;
      while (explicitIds.has(id) || usedIds.has(id)) id = `_${id}`;
    }
    usedIds.add(id);
    const node: DiagramNode = {
      id,
      label,
      shape: stack.length ? "default" : "round",
      depth: stack.length,
    };
    nodes.push(node);
    if (explicitId) aliases.set(explicitId, [...(aliases.get(explicitId) ?? []), node]);
    if (stack.length)
      edges.push({
        source: stack[stack.length - 1].id,
        target: id,
        arrow: false,
      });
    stack.push({ indent, id });
  }
  if (!nodes.length) throw new Error("Empty mindmap");
  for (const { id, anchor } of anchors) {
    const matches = aliases.get(id) ?? [];
    // Identical repeated UI nodes represent the same location; ambiguous IDs do not.
    if (matches.every(node => node.label === matches[0]?.label)) {
      matches.forEach(node => (node.ui ??= []).push(anchor));
    }
  }
  for (const annotation of annotations) {
    const matches = aliases.get(annotation.id) ?? [];
    if (matches.every(node => node.label === matches[0]?.label)) {
      matches.forEach(node => {
        if (annotation.source) node.source = annotation.source;
        if (annotation.field) node.field = annotation.field;
      });
    }
  }
  return { kind: "mindmap", direction: "LR", nodes, edges };
}

const NODE =
  /^([A-Za-z_](?:(?!--|-\.->)[\w.-])*)(?:\s*(\(\([\s\S]*?\)\)|\[[\s\S]*?\]|\{[\s\S]*?\}|\([\s\S]*?\)))?/;
const LINK = /^\s*(-->|---|-\.->|==>|--\s+[^\n]+?\s+-->)\s*(?:\|([^|]*)\|)?\s*/;

/** Newlines and semicolons inside node labels are not statement boundaries. */
function flowchartStatements(lines: string[]): string[] {
  const statements: string[] = [];
  let current = '', opening = '', depth = 0, quoted = false, escaped = false;
  const closing: Record<string, string> = { '[': ']', '{': '}', '(': ')' };
  for (const line of lines) {
    if (!depth && !quoted && !current.trim() && line.trimStart().startsWith('%%')) {
      statements.push(line);
      continue;
    }
    for (const char of `${line}\n`) {
      if (quoted) {
        current += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (depth && char === opening) depth++;
      else if (depth && char === closing[opening]) { if (!--depth) opening = ''; }
      else if (!depth && closing[char]) { opening = char; depth = 1; }
      if (!depth && !quoted && (char === '\n' || char === ';')) {
        if (current.trim()) statements.push(current);
        current = '';
      } else current += char;
    }
  }
  if (current.trim()) statements.push(current);
  return statements;
}

function parseFlowchart(header: string, lines: string[]): ParsedDiagram {
  const match = header.match(
    /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?\s*$/i,
  );
  if (!match) throw new Error("Unsupported flowchart header");
  const direction = (
    match[1]?.toUpperCase() === "TD" ? "TB" : match[1]?.toUpperCase() || "TB"
  ) as ParsedDiagram["direction"];
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const anchors: Array<{ id: string; anchor: UiAnchor }> = [];
  const annotations: DataAnnotation[] = [];
  function readNode(input: string) {
    const item = input.match(NODE);
    if (!item) throw new Error("Unsupported flowchart node");
    const [, id, form] = item;
    const prior = nodes.get(id);
    if (form || !prior) {
      const shape = form?.startsWith("{")
        ? "decision"
        : form?.startsWith("(")
          ? "round"
          : "default";
      const inner = form
        ? form.replace(/^\(\(|\)\)$/g, "").replace(/^[\[({]|[\])}]$/g, "")
        : id;
      nodes.set(id, { id, label: cleanLabel(inner), shape });
    }
    return { id, rest: input.slice(item[0].length) };
  }
  for (const statement of flowchartStatements(lines)) {
    let line = statement.trim();
    if (!line) continue;
    if (line.startsWith("%%")) {
      const anchor = readUiAnchor(line);
      if (anchor) anchors.push(anchor);
      const annotation = readDataAnnotation(line);
      if (annotation) annotations.push(annotation);
      continue;
    }
    let current = readNode(line);
    line = current.rest;
    while (line.trim()) {
      const link = line.match(LINK);
      if (!link) throw new Error("Unsupported flowchart connection");
      const next = readNode(line.slice(link[0].length));
      edges.push({
        source: current.id,
        target: next.id,
        label: link[2]
          ? cleanLabel(link[2])
          : link[1].startsWith("-- ")
            ? cleanLabel(link[1].slice(2, -3))
            : undefined,
        dashed: link[1] === "-.->",
        arrow: link[1] !== "---",
      });
      current = next;
      line = next.rest;
    }
  }
  if (!nodes.size) throw new Error("Empty flowchart");
  attachUiAnchors([...nodes.values()], anchors);
  attachDataAnnotations([...nodes.values()], annotations);
  return { kind: "flowchart", direction, nodes: [...nodes.values()], edges };
}

export function parseDiagram(content: string): ParsedDiagram {
  const definition = content
    .match(/```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/i)?.[1]
    ?.trim();
  if (!definition) throw new Error("Mermaid block not found");
  const [firstLine, ...lines] = definition.split(/\r?\n/);
  const [header, ...firstStatements] = firstLine.split(";");
  if (firstStatements.length) lines.unshift(firstStatements.join(';'));
  if (header.trim().toLowerCase() === "mindmap") return parseMindmap(lines);
  return parseFlowchart(header.trim(), lines);
}
