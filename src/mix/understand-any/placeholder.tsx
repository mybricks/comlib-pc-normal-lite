import React from "react";
import { copy } from "./index.i18n";
import * as lazyCss from "./index.lazy.less";
import { getLazyCss } from "../lowcodeView/utils/css";
const css = getLazyCss(lazyCss);

type Box = { x: number; y: number; w: number; h: number; r: number };
type Link = { from: string; to: string };

const MIND_BOXES: Box[] = [
  { x: 16, y: 61, w: 76, h: 28, r: 7 },
  { x: 124, y: 17, w: 76, h: 28, r: 7 },
  { x: 124, y: 61, w: 76, h: 28, r: 7 },
  { x: 124, y: 105, w: 76, h: 28, r: 7 },
  { x: 232, y: 61, w: 72, h: 28, r: 7 },
];

const FLOW_BOXES: Box[] = [
  { x: 112, y: 6, w: 96, h: 24, r: 12 },
  { x: 112, y: 42, w: 96, h: 24, r: 6 },
  { x: 112, y: 78, w: 96, h: 24, r: 6 },
  { x: 112, y: 114, w: 96, h: 24, r: 12 },
  { x: 244, y: 78, w: 60, h: 24, r: 6 },
];

const LINKS: Link[] = [
  { from: "M92 75 C100 75 116 75 124 75", to: "M160 30 C160 34 160 38 160 42" },
  { from: "M92 75 C104 75 104 31 124 31", to: "M160 66 C160 70 160 74 160 78" },
  {
    from: "M92 75 C104 75 104 119 124 119",
    to: "M160 102 C160 106 160 110 160 114",
  },
  {
    from: "M200 75 C210 75 222 75 232 75",
    to: "M208 90 C220 90 232 90 244 90",
  },
];

const DURATION = "4.4s";
const KEY_TIMES = "0;0.15;0.5;0.65;1";
const KEY_SPLINES = "0 0 1 1;0.42 0 0.2 1;0 0 1 1;0.42 0 0.2 1";

function morphValues(from: number, to: number) {
  return `${from};${from};${to};${to};${from}`;
}

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function NodeBox({
  mind,
  flow,
  animate,
  stroke,
}: {
  mind: Box;
  flow: Box;
  animate: boolean;
  stroke: string;
}) {
  return (
    <rect
      x={mind.x}
      y={mind.y}
      width={mind.w}
      height={mind.h}
      rx={mind.r}
      stroke={stroke}
    >
      {animate && (
        <>
          <animate
            attributeName="x"
            values={morphValues(mind.x, flow.x)}
            keyTimes={KEY_TIMES}
            keySplines={KEY_SPLINES}
            calcMode="spline"
            dur={DURATION}
            repeatCount="indefinite"
          />
          <animate
            attributeName="y"
            values={morphValues(mind.y, flow.y)}
            keyTimes={KEY_TIMES}
            keySplines={KEY_SPLINES}
            calcMode="spline"
            dur={DURATION}
            repeatCount="indefinite"
          />
          <animate
            attributeName="width"
            values={morphValues(mind.w, flow.w)}
            keyTimes={KEY_TIMES}
            keySplines={KEY_SPLINES}
            calcMode="spline"
            dur={DURATION}
            repeatCount="indefinite"
          />
          <animate
            attributeName="height"
            values={morphValues(mind.h, flow.h)}
            keyTimes={KEY_TIMES}
            keySplines={KEY_SPLINES}
            calcMode="spline"
            dur={DURATION}
            repeatCount="indefinite"
          />
          <animate
            attributeName="rx"
            values={morphValues(mind.r, flow.r)}
            keyTimes={KEY_TIMES}
            keySplines={KEY_SPLINES}
            calcMode="spline"
            dur={DURATION}
            repeatCount="indefinite"
          />
        </>
      )}
    </rect>
  );
}

function LinkPath({
  from,
  to,
  animate,
  stroke,
}: Link & { animate: boolean; stroke: string }) {
  return (
    <path d={from} stroke={stroke}>
      {animate && (
        <animate
          attributeName="d"
          values={`${from};${from};${to};${to};${from}`}
          keyTimes={KEY_TIMES}
          keySplines={KEY_SPLINES}
          calcMode="spline"
          dur={DURATION}
          repeatCount="indefinite"
        />
      )}
    </path>
  );
}

export function PlaceholderDiagram({
  loading,
  onGenerate,
}: {
  loading?: boolean;
  onGenerate: () => void;
}) {
  const reduced = useReducedMotion();
  const animate = Boolean(loading) && !reduced;
  const stroke = "var(--mybricks-text-color-secondary, #8a909d)";
  return (
    <div
      className={`${css["bizai-placeholder"]} ${loading ? css["bizai-placeholder-loading"] : ""}`}
      role={loading ? "status" : undefined}
      aria-label={loading ? copy.generating() : undefined}
    >
      <div className={css["bizai-placeholder-figure"]}>
        <svg viewBox="0 0 320 150" fill="none" aria-hidden="true">
          {LINKS.map((link, index) => (
            <LinkPath
              key={`link-${index}`}
              from={link.from}
              to={link.to}
              animate={animate}
              stroke={stroke}
            />
          ))}
          {MIND_BOXES.map((mind, index) => (
            <NodeBox
              key={`box-${index}`}
              mind={mind}
              flow={FLOW_BOXES[index]}
              animate={animate}
              stroke={stroke}
            />
          ))}
        </svg>
      </div>
      {!loading && (
        <span className={css["bizai-placeholder-text"]}>
          <span
            role="button"
            tabIndex={0}
            className={css["bizai-placeholder-action"]}
            onClick={onGenerate}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onGenerate();
              }
            }}
          >
            {copy.placeholderAction()}
          </span>
          {copy.placeholderSubject()}
        </span>
      )}
    </div>
  );
}
