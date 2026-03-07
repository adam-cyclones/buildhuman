// RingEditor: SVG cross-section editor for a single radial profile ring.
// Shows the active ring with draggable handles, and a ghost of an adjacent ring.

import { createSignal, For, Show } from "solid-js";

type RingEditorProps = {
  activeRing: number[];
  ghostRing: number[] | null;   // adjacent ring shown as semi-transparent reference
  onHandleChange: (ptIdx: number, radius: number) => void;
  onAddHandle: (afterPtIdx: number) => void;
  onRemoveHandle: (ptIdx: number) => void;
};

const SIZE = 240;
const CX = SIZE / 2;
const CY = SIZE / 2;
const MAX_DISPLAY_RADIUS = 0.18; // world units mapped to CX - padding
const PADDING = 20;
const SCALE = (CX - PADDING) / MAX_DISPLAY_RADIUS;
const HANDLE_R = 5;

/** Convert a ring (radii array) to SVG canvas points */
function ringToPoints(ring: number[]): [number, number][] {
  return ring.map((r, i) => {
    const angle = (i / ring.length) * 2 * Math.PI - Math.PI / 2;
    return [CX + r * SCALE * Math.cos(angle), CY + r * SCALE * Math.sin(angle)];
  });
}

/** Build a closed cubic Bezier SVG path from points using Catmull-Rom tangents */
function catmullRomPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return "";
  const get = (i: number) => pts[((i % n) + n) % n];

  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + " Z";
}

/** Find the index of the segment gap nearest to a point on the ring */
function nearestGapIndex(px: number, py: number, pts: [number, number][]): number {
  let best = 0;
  let bestDist = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const d = (px - mx) ** 2 + (py - my) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

const RingEditor = (props: RingEditorProps) => {
  const [dragging, setDragging] = createSignal<number | null>(null);

  const activePoints = () => ringToPoints(props.activeRing);
  const ghostPoints = () => props.ghostRing ? ringToPoints(props.ghostRing) : null;
  const activePath = () => catmullRomPath(activePoints());
  const ghostPath = () => {
    const gp = ghostPoints();
    return gp ? catmullRomPath(gp) : null;
  };

  const handleMouseDown = (e: MouseEvent, ptIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(ptIdx);
  };

  const handleSvgMouseMove = (e: MouseEvent) => {
    const idx = dragging();
    if (idx === null) return;
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - CX;
    const y = e.clientY - rect.top - CY;
    const newRadius = Math.sqrt(x * x + y * y) / SCALE;
    props.onHandleChange(idx, newRadius);
  };

  const handleSvgMouseUp = () => setDragging(null);

  const handlePathDblClick = (e: MouseEvent) => {
    const svg = (e.currentTarget as SVGPathElement).ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const afterIdx = nearestGapIndex(px, py, activePoints());
    props.onAddHandle(afterIdx);
  };

  const handleHandleDblClick = (e: MouseEvent, ptIdx: number) => {
    e.stopPropagation();
    if (props.activeRing.length > 3) {
      props.onRemoveHandle(ptIdx);
    }
  };

  return (
    <svg
      width={SIZE}
      height={SIZE}
      style={{ display: "block", cursor: dragging() !== null ? "crosshair" : "default", "user-select": "none" }}
      onMouseMove={handleSvgMouseMove}
      onMouseUp={handleSvgMouseUp}
      onMouseLeave={handleSvgMouseUp}
    >
      {/* Background */}
      <rect width={SIZE} height={SIZE} fill="#1a1a1a" rx="4" />

      {/* Guide circle at max radius */}
      <circle cx={CX} cy={CY} r={(CX - PADDING)} fill="none" stroke="#333" stroke-width="1" stroke-dasharray="4 4" />

      {/* Center crosshair */}
      <line x1={CX - 6} y1={CY} x2={CX + 6} y2={CY} stroke="#444" stroke-width="1" />
      <line x1={CX} y1={CY - 6} x2={CX} y2={CY + 6} stroke="#444" stroke-width="1" />

      {/* Radial lines from center to handles */}
      <For each={activePoints()}>
        {(pt) => (
          <line x1={CX} y1={CY} x2={pt[0]} y2={pt[1]} stroke="#2a2a2a" stroke-width="1" />
        )}
      </For>

      {/* Ghost ring */}
      <Show when={ghostPath()}>
        <path
          d={ghostPath()!}
          fill="rgba(100,160,255,0.08)"
          stroke="rgba(100,160,255,0.35)"
          stroke-width="1.5"
          stroke-dasharray="5 3"
        />
      </Show>

      {/* Active ring path — dbl-click to add handle */}
      <path
        d={activePath()}
        fill="rgba(255,200,80,0.08)"
        stroke="#f5c842"
        stroke-width="2"
        onDblClick={handlePathDblClick}
        style={{ cursor: "copy" }}
      />

      {/* Handles */}
      <For each={activePoints()}>
        {(pt, i) => (
          <circle
            cx={pt[0]}
            cy={pt[1]}
            r={HANDLE_R}
            fill={dragging() === i() ? "#fff" : "#f5c842"}
            stroke="#1a1a1a"
            stroke-width="1.5"
            style={{ cursor: "grab" }}
            onMouseDown={(e) => handleMouseDown(e, i())}
            onDblClick={(e) => handleHandleDblClick(e, i())}
          />
        )}
      </For>
    </svg>
  );
};

export default RingEditor;
