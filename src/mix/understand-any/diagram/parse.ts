export type DiagramNode = {
  id: string;
  label: string;
  shape: "default" | "round" | "decision";
  depth?: number;
};
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
    .trim();
}

function parseMindmap(lines: string[]): ParsedDiagram {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const stack: Array<{ indent: number; id: string }> = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("%%")) continue;
    const indent = line.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
    const text = line.trim();
    if (/^::/.test(text)) throw new Error("Unsupported mindmap decoration");
    const shape = text.match(
      /^(?:[\w-]+)?(?:\(\((.+)\)\)|\[(.+)\]|\((.+)\)|\{\{(.+)\}\})$/,
    );
    const label = cleanLabel(shape ? shape.slice(1).find(Boolean)! : text);
    if (!label) throw new Error("Empty mindmap node");
    while (stack.length && indent <= stack[stack.length - 1].indent)
      stack.pop();
    if (nodes.length && !stack.length)
      throw new Error("Mindmap must have one root");
    const id = `mind-${nodes.length}`;
    nodes.push({
      id,
      label,
      shape: stack.length ? "default" : "round",
      depth: stack.length,
    });
    if (stack.length)
      edges.push({
        source: stack[stack.length - 1].id,
        target: id,
        arrow: false,
      });
    stack.push({ indent, id });
  }
  if (!nodes.length) throw new Error("Empty mindmap");
  return { kind: "mindmap", direction: "LR", nodes, edges };
}

const NODE =
  /^([A-Za-z_](?:(?!--|-\.->)[\w.-])*)(?:\s*(\(\([\s\S]*?\)\)|\[[\s\S]*?\]|\{[\s\S]*?\}|\([\s\S]*?\)))?/;
const LINK = /^\s*(-->|---|-\.->|==>|--\s+[^\n]+?\s+-->)\s*(?:\|([^|]*)\|)?\s*/;

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
  for (const statement of lines.join("\n").split(/[;\n]/)) {
    let line = statement.trim();
    if (!line || line.startsWith("%%")) continue;
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
  return { kind: "flowchart", direction, nodes: [...nodes.values()], edges };
}

export function parseDiagram(content: string): ParsedDiagram {
  const definition = content
    .match(/```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/i)?.[1]
    ?.trim();
  if (!definition) throw new Error("Mermaid block not found");
  const [firstLine, ...lines] = definition.split(/\r?\n/);
  const [header, ...firstStatements] = firstLine.split(";");
  lines.unshift(...firstStatements);
  if (header.trim().toLowerCase() === "mindmap") return parseMindmap(lines);
  return parseFlowchart(header.trim(), lines);
}
