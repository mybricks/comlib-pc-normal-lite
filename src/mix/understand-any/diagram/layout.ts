import dagre from "dagre";
import type { DiagramEdge, DiagramNode, ParsedDiagram } from "./parse";

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 56;

type Point = { x: number; y: number };
export type LayoutNode = DiagramNode & { position: Point };
export type LayoutEdge = DiagramEdge & {
  points: Point[];
  labelPosition?: Point;
};

/** Convert Dagre's routing waypoints into right-angled segments. */
export function orthogonalPoints(points: Point[], vertical: boolean): Point[] {
  if (points.length < 2) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    if (prev.x !== next.x && prev.y !== next.y) {
      if (vertical) {
        const y = (prev.y + next.y) / 2;
        result.push({ x: prev.x, y }, { x: next.x, y });
      } else {
        const x = (prev.x + next.x) / 2;
        result.push({ x, y: prev.y }, { x, y: next.y });
      }
    }
    result.push(next);
  }
  return result;
}

function intersectsNode(a: Point, b: Point, node: LayoutNode): boolean {
  const { x, y } = node.position;
  const epsilon = 0.01;
  if (Math.abs(a.x - b.x) < epsilon) {
    return (
      a.x > x + epsilon &&
      a.x < x + NODE_WIDTH - epsilon &&
      Math.max(a.y, b.y) > y + epsilon &&
      Math.min(a.y, b.y) < y + NODE_HEIGHT - epsilon
    );
  }
  if (Math.abs(a.y - b.y) < epsilon) {
    return (
      a.y > y + epsilon &&
      a.y < y + NODE_HEIGHT - epsilon &&
      Math.max(a.x, b.x) > x + epsilon &&
      Math.min(a.x, b.x) < x + NODE_WIDTH - epsilon
    );
  }
  return true;
}

/** Skip unnecessary waypoints only when the shortcut stays outside every node. */
export function simplifyRoute(
  points: Point[],
  nodes: LayoutNode[],
  vertical: boolean,
): Point[] {
  if (points.length < 3) return points;
  const result = [points[0]];
  let current = 0;
  while (current < points.length - 1) {
    let next = current + 1;
    let shortcut: Point[] = [points[current], points[next]];
    for (
      let candidate = points.length - 1;
      candidate > current + 1;
      candidate--
    ) {
      const route = orthogonalPoints(
        [points[current], points[candidate]],
        vertical,
      );
      if (
        route.every(
          (point, index) =>
            index === 0 ||
            nodes.every(
              (node) => !intersectsNode(route[index - 1], point, node),
            ),
        )
      ) {
        next = candidate;
        shortcut = route;
        break;
      }
    }
    result.push(...shortcut.slice(1));
    current = next;
  }
  const unique = result.filter(
    (point, index, all) =>
      index === 0 ||
      point.x !== all[index - 1].x ||
      point.y !== all[index - 1].y,
  );
  return unique.filter((point, index, all) => {
    if (index === 0 || index === all.length - 1) return true;
    const prev = all[index - 1];
    const next = all[index + 1];
    const sameVertical =
      prev.x === point.x &&
      point.x === next.x &&
      (point.y - prev.y) * (next.y - point.y) >= 0;
    const sameHorizontal =
      prev.y === point.y &&
      point.y === next.y &&
      (point.x - prev.x) * (next.x - point.x) >= 0;
    return !sameVertical && !sameHorizontal;
  });
}

/** Round the corners without changing the route's start or end. */
export function roundedPath(points: Point[], radius = 8): string {
  if (!points.length) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const prev = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incoming = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    if (!incoming || !outgoing) continue;
    const distance = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: corner.x + ((prev.x - corner.x) * distance) / incoming,
      y: corner.y + ((prev.y - corner.y) * distance) / incoming,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) * distance) / outgoing,
      y: corner.y + ((next.y - corner.y) * distance) / outgoing,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function edgeLabelPosition(
  points: Point[],
  vertical: boolean,
): Point | undefined {
  const segments = points
    .slice(1)
    .map((end, index) => ({ start: points[index], end }));
  const preferred = segments.find(({ start, end }) =>
    vertical
      ? Math.abs(end.x - start.x) >= 18
      : Math.abs(end.y - start.y) >= 18,
  );
  const segment =
    preferred ??
    segments.reduce<(typeof segments)[number] | undefined>(
      (best, current) =>
        !best ||
        Math.abs(current.end.x - current.start.x) +
          Math.abs(current.end.y - current.start.y) >
          Math.abs(best.end.x - best.start.x) +
            Math.abs(best.end.y - best.start.y)
          ? current
          : best,
      undefined,
    );
  return (
    segment && {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    }
  );
}

export function createFlowLayout(diagram: ParsedDiagram): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
} {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: diagram.direction,
    nodesep: diagram.kind === "mindmap" ? 14 : 60,
    ranksep: 68,
    edgesep: 30,
    marginx: diagram.kind === "mindmap" ? 24 : 48,
    marginy: diagram.kind === "mindmap" ? 24 : 32,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  diagram.nodes.forEach((node) =>
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }),
  );
  diagram.edges.forEach((edge, index) =>
    graph.setEdge(
      edge.source,
      edge.target,
      {
        width: edge.label
          ? Math.min(160, Math.max(28, edge.label.length * 14))
          : 0,
        height: edge.label ? 22 : 0,
      },
      String(index),
    ),
  );
  dagre.layout(graph);
  const nodes = diagram.nodes.map((node) => {
    const point = graph.node(node.id);
    return {
      ...node,
      position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
    };
  });
  const edges = diagram.edges.map((edge, index) => {
    const route = graph.edge(edge.source, edge.target, String(index));
    const vertical = diagram.direction === "TB" || diagram.direction === "BT";
    const source = nodes.find(node => node.id === edge.source);
    const target = nodes.find(node => node.id === edge.target);
    const mindmapPoints = diagram.kind === "mindmap" && source && target
      ? [
          { x: source.position.x + NODE_WIDTH, y: source.position.y + NODE_HEIGHT / 2 },
          { x: target.position.x, y: target.position.y + NODE_HEIGHT / 2 },
        ]
      : undefined;
    const points = simplifyRoute(
      orthogonalPoints(mindmapPoints ?? route?.points ?? [], vertical),
      nodes,
      vertical,
    );
    return {
      ...edge,
      points,
      ...(edge.label
        ? { labelPosition: edgeLabelPosition(points, vertical) }
        : {}),
    };
  });
  return { nodes, edges };
}
