import dagre from "dagre";
import type { DiagramEdge, DiagramNode, ParsedDiagram } from "./parse";

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 56;
export const DECISION_WIDTH = 144;
export const DECISION_HEIGHT = 88;

type Point = { x: number; y: number };
export type LayoutNode = DiagramNode & { position: Point; width: number; height: number };
export type LayoutEdge = DiagramEdge & {
  points: Point[];
  labelPosition?: Point;
  junction?: Point;
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
      a.x < x + node.width - epsilon &&
      Math.max(a.y, b.y) > y + epsilon &&
      Math.min(a.y, b.y) < y + node.height - epsilon
    );
  }
  if (Math.abs(a.y - b.y) < epsilon) {
    return (
      a.y > y + epsilon &&
      a.y < y + node.height - epsilon &&
      Math.max(a.x, b.x) > x + epsilon &&
      Math.min(a.x, b.x) < x + node.width - epsilon
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

type Box = { x: number; y: number; width: number; height: number };

/** Conservative dimensions for the 12px SVG label and its background. */
export function edgeLabelSize(label: string) {
  return { width: Math.max(28, Array.from(label).length * 12 + 12), height: 24 };
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

function placeEdgeLabels(edges: LayoutEdge[], nodes: LayoutNode[], vertical: boolean) {
  const occupied: Box[] = nodes.map(node => ({
    x: node.position.x - 4, y: node.position.y - 4,
    width: node.width + 8, height: node.height + 8,
  }));
  for (const edge of edges) {
    if (!edge.label || edge.points.length < 2) continue;
    const size = edgeLabelSize(edge.label);
    const segments = edge.points.slice(1).map((end, index) => ({ start: edge.points[index], end, index }))
      .sort((a, b) => {
        const along = (segment: typeof a) => vertical ? Math.abs(segment.end.y - segment.start.y) : Math.abs(segment.end.x - segment.start.x);
        return Number(along(b) > 0) - Number(along(a) > 0) || b.index - a.index;
      });
    const candidates: Point[] = [];
    // First try positions on the route, then gradually move away from it.
    for (const offset of [0, 16, -16, 32, -32, 48, -48, 72, -72, 104, -104, 144, -144]) {
      for (const { start, end } of segments) {
        const horizontal = start.y === end.y;
        for (const fraction of [0.5, 0.25, 0.75]) {
          candidates.push({ x: start.x + (end.x - start.x) * fraction + (horizontal ? 0 : offset),
            y: start.y + (end.y - start.y) * fraction + (horizontal ? offset : 0) });
        }
      }
    }
    const boxAt = (point: Point): Box => ({ x: point.x - size.width / 2 - 3, y: point.y - size.height / 2 - 3,
      width: size.width + 6, height: size.height + 6 });
    const crossesOtherEdge = (box: Box) => edges.some(other => other !== edge && other.points.slice(1).some((end, index) => {
      const start = other.points[index];
      if (start.x === end.x) return start.x > box.x && start.x < box.x + box.width && Math.max(start.y, end.y) > box.y && Math.min(start.y, end.y) < box.y + box.height;
      if (start.y === end.y) return start.y > box.y && start.y < box.y + box.height && Math.max(start.x, end.x) > box.x && Math.min(start.x, end.x) < box.x + box.width;
      return false;
    }));
    const available = (candidate: Point) => occupied.every(box => !overlaps(boxAt(candidate), box));
    let point = candidates.find(candidate => available(candidate) && !crossesOtherEdge(boxAt(candidate))) ?? candidates.find(available);
    // Dense graphs can exhaust positions close to a route; continue searching
    // outside the occupied area instead of stacking labels on top of each other.
    if (!point) {
      const origin = candidates[0];
      for (let radius = 180; !point; radius += 36) {
        const ring = [
          { x: origin.x + radius, y: origin.y }, { x: origin.x - radius, y: origin.y },
          { x: origin.x, y: origin.y + radius }, { x: origin.x, y: origin.y - radius },
        ];
        point = ring.find(candidate => occupied.every(box => !overlaps(boxAt(candidate), box)));
      }
    }
    edge.labelPosition = point;
    occupied.push(boxAt(point));
  }
}

/** Share one output port and a visible junction for branches in the same rank. */
function routeBranches(edges: LayoutEdge[], nodes: LayoutNode[], direction: ParsedDiagram['direction']) {
  const vertical = direction === 'TB' || direction === 'BT';
  const reverse = direction === 'BT' || direction === 'RL';
  const sign = reverse ? -1 : 1;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const groups = new Map<string, LayoutEdge[]>();
  for (const edge of edges) groups.set(edge.source, [...(groups.get(edge.source) ?? []), edge]);
  for (const [sourceId, group] of groups) {
    if (group.length < 2) continue;
    if (group.some(edge => !!edge.dashed !== !!group[0].dashed || !!edge.arrow !== !!group[0].arrow)) continue;
    const source = byId.get(sourceId);
    const targets = group.map(edge => byId.get(edge.target));
    if (!source || targets.some(target => !target) || new Set(group.map(edge => edge.target)).size !== group.length) continue;
    const port = (node: LayoutNode, outgoing: boolean): Point => vertical
      ? { x: node.position.x + node.width / 2, y: node.position.y + ((outgoing !== reverse) ? node.height : 0) }
      : { x: node.position.x + ((outgoing !== reverse) ? node.width : 0), y: node.position.y + node.height / 2 };
    const start = port(source, true);
    const ends = (targets as LayoutNode[]).map(target => port(target, false));
    const axis = (point: Point) => vertical ? point.y : point.x;
    const distance = Math.min(...ends.map(end => (axis(end) - axis(start)) * sign));
    // Avoid routing through intermediate ranks or backwards edges.
    if (distance < 48 || ends.some(end => Math.abs(axis(end) - axis(ends[0])) > 1)) continue;
    const junction = vertical ? { x: start.x, y: start.y + sign * Math.min(36, distance / 3) }
      : { x: start.x + sign * Math.min(36, distance / 3), y: start.y };
    const routes = ends.map(end => [start, junction, vertical ? { x: end.x, y: junction.y } : { x: junction.x, y: end.y }, end]
      .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y));
    if (routes.some(points => points.slice(1).some((end, index) => nodes.some(node =>
      node.id !== sourceId && intersectsNode(points[index], end, node))))) continue;
    group.forEach((edge, index) => { edge.points = routes[index]; edge.junction = junction; });
  }
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
    graph.setNode(node.id, {
      width: node.shape === 'decision' ? DECISION_WIDTH : NODE_WIDTH,
      height: node.shape === 'decision' ? DECISION_HEIGHT : NODE_HEIGHT,
    }),
  );
  diagram.edges.forEach((edge, index) =>
    graph.setEdge(
      edge.source,
      edge.target,
      {
        width: edge.label ? edgeLabelSize(edge.label).width : 0,
        height: edge.label ? edgeLabelSize(edge.label).height : 0,
      },
      String(index),
    ),
  );
  dagre.layout(graph);
  const nodes = diagram.nodes.map((node) => {
    const point = graph.node(node.id);
    return {
      ...node,
      width: point.width,
      height: point.height,
      position: { x: point.x - point.width / 2, y: point.y - point.height / 2 },
    };
  });
  const edges = diagram.edges.map((edge, index) => {
    const route = graph.edge(edge.source, edge.target, String(index));
    const vertical = diagram.direction === "TB" || diagram.direction === "BT";
    const source = nodes.find(node => node.id === edge.source);
    const target = nodes.find(node => node.id === edge.target);
    const mindmapPoints = diagram.kind === "mindmap" && source && target
      ? vertical
        ? [
            { x: source.position.x + source.width / 2, y: source.position.y + source.height },
            { x: target.position.x + target.width / 2, y: target.position.y },
          ]
        : [
            { x: source.position.x + source.width, y: source.position.y + source.height / 2 },
            { x: target.position.x, y: target.position.y + target.height / 2 },
          ]
      : undefined;
    const routePoints = route?.points?.map(point => ({ ...point })) ?? [];
    const reverse = diagram.direction === 'BT' || diagram.direction === 'RL';
    if (routePoints.length && source) {
      routePoints[0] = vertical
        ? { x: source.position.x + source.width / 2, y: source.position.y + (reverse ? 0 : source.height) }
        : { x: source.position.x + (reverse ? 0 : source.width), y: source.position.y + source.height / 2 };
    }
    if (routePoints.length && target) {
      routePoints[routePoints.length - 1] = vertical
        ? { x: target.position.x + target.width / 2, y: target.position.y + (reverse ? target.height : 0) }
        : { x: target.position.x + (reverse ? target.width : 0), y: target.position.y + target.height / 2 };
    }
    const points = simplifyRoute(
      orthogonalPoints(mindmapPoints ?? routePoints, vertical),
      nodes,
      vertical,
    );
    return {
      ...edge,
      points,
    };
  });
  if (diagram.kind === 'flowchart') routeBranches(edges, nodes, diagram.direction);
  placeEdgeLabels(edges, nodes, diagram.direction === 'TB' || diagram.direction === 'BT');
  return { nodes, edges };
}
