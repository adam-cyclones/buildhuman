import { onMount, createEffect } from "solid-js";
import "./ProfileEditor.css";

type ControlPoint = {
  u: number;
  v: number;
  handleIn?: { u: number; v: number };  // Tangent handle coming into the point
  handleOut?: { u: number; v: number }; // Tangent handle going out of the point
};

type ProfileEditorProps = {
  mouldId: string | null;
  segmentIndex: number | null;
  profile: number[] | null; // Current radial profile data
  prevProfile?: number[] | null; // Previous segment for onion skin
  nextProfile?: number[] | null; // Next segment for onion skin
  onProfileChange: (controlPoints: Array<{u: number; v: number}>) => void;
};

/**
 * 2D Bezier curve editor for profile rings
 *
 * Shows an "end-on" view of the selected profile ring with:
 * - Blue control points (draggable)
 * - Gray tangent handles (for curve smoothness)
 * - Pink interpolated curve
 */
export default function ProfileEditor(props: ProfileEditorProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;

  // Editor state
  let controlPoints: ControlPoint[] = [];
  let selectedPointIndices: Set<number> = new Set(); // Multi-select support
  let selectedHandleType: 'in' | 'out' | null = null; // Which handle is being dragged
  let isDragging = false;
  let isDraggingHandle = false;
  let dragStartPoint: {u: number; v: number} | null = null;

  // Canvas dimensions
  const CANVAS_SIZE = 300;
  const CENTER_X = CANVAS_SIZE / 2;
  const CENTER_Y = CANVAS_SIZE / 2;
  const SCALE = 1000; // Scale factor for world units to pixels

  onMount(() => {
    if (!canvasRef) return;
    ctx = canvasRef.getContext("2d");

    // Initialize control points from radial profile
    initializeControlPoints();

    // Initial render
    render();
  });

  // Re-initialize when profile changes
  createEffect(() => {
    const profile = props.profile;
    if (profile) {
      initializeControlPoints();
      render();
    }
  });

  /**
   * Convert current radial profile to 2D control points with tangent handles
   */
  function initializeControlPoints() {
    if (!props.profile) return;

    const numPoints = props.profile.length;
    controlPoints = [];

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const radius = props.profile[i];

      // Convert polar to cartesian
      const u = radius * Math.cos(angle);
      const v = radius * Math.sin(angle);

      // Calculate automatic tangent handles (smooth bezier)
      const prevAngle = ((i - 1 + numPoints) % numPoints / numPoints) * Math.PI * 2;
      const nextAngle = ((i + 1) % numPoints / numPoints) * Math.PI * 2;
      const prevRadius = props.profile[(i - 1 + numPoints) % numPoints];
      const nextRadius = props.profile[(i + 1) % numPoints];

      const prevU = prevRadius * Math.cos(prevAngle);
      const prevV = prevRadius * Math.sin(prevAngle);
      const nextU = nextRadius * Math.cos(nextAngle);
      const nextV = nextRadius * Math.sin(nextAngle);

      // Tangent is along the direction from prev to next
      const tangentU = (nextU - prevU) / 6; // Scale factor for handle length
      const tangentV = (nextV - prevV) / 6;

      controlPoints.push({
        u,
        v,
        handleIn: { u: u - tangentU, v: v - tangentV },
        handleOut: { u: u + tangentU, v: v + tangentV },
      });
    }
  }

  /**
   * Convert world coordinates to canvas pixels
   */
  function worldToCanvas(u: number, v: number): {x: number; y: number} {
    return {
      x: CENTER_X + u * SCALE,
      y: CENTER_Y - v * SCALE  // Flip Y axis
    };
  }

  /**
   * Convert canvas pixels to world coordinates
   */
  function canvasToWorld(x: number, y: number): {u: number; v: number} {
    return {
      u: (x - CENTER_X) / SCALE,
      v: -(y - CENTER_Y) / SCALE  // Flip Y axis
    };
  }

  /**
   * Main render function
   */
  function render() {
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw grid
    drawGrid();

    // Draw center axes
    drawAxes();

    // Draw interpolated curve (pink)
    drawCurve();

    // Draw control points (blue)
    drawControlPoints();
  }

  function drawGrid() {
    if (!ctx) return;

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = 0; x <= CANVAS_SIZE; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_SIZE);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= CANVAS_SIZE; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_SIZE, y);
      ctx.stroke();
    }
  }

  function drawAxes() {
    if (!ctx) return;

    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;

    // Horizontal axis
    ctx.beginPath();
    ctx.moveTo(0, CENTER_Y);
    ctx.lineTo(CANVAS_SIZE, CENTER_Y);
    ctx.stroke();

    // Vertical axis
    ctx.beginPath();
    ctx.moveTo(CENTER_X, 0);
    ctx.lineTo(CENTER_X, CANVAS_SIZE);
    ctx.stroke();
  }

  /**
   * Draw orientation label showing north direction (fixed anatomical reference)
   */
  function drawOrientationLabel() {
    if (!ctx) return;

    // North/Front is the anatomical front direction, fixed to the skeleton
    // Position at top of canvas (north position)
    ctx.fillStyle = "#00ff00";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    // Position at top, horizontally centered
    ctx.fillText("FRONT", CENTER_X, 5);

    // Draw arrow pointing upward
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CENTER_X, 25);
    ctx.lineTo(CENTER_X, 15);
    ctx.stroke();

    // Arrow head pointing up
    ctx.beginPath();
    ctx.moveTo(CENTER_X, 15);
    ctx.lineTo(CENTER_X - 3, 18);
    ctx.lineTo(CENTER_X + 3, 18);
    ctx.closePath();
    ctx.fillStyle = "#00ff00";
    ctx.fill();
  }

  /**
   * Draw smooth bezier curve through control points
   */
  function drawCurve() {
    if (!ctx || controlPoints.length < 3) return;

    ctx.strokeStyle = "#ff8888"; // Pink
    ctx.lineWidth = 2;
    ctx.beginPath();

    // Start at first point
    const firstPoint = controlPoints[0];
    const {x: x0, y: y0} = worldToCanvas(firstPoint.u, firstPoint.v);
    ctx.moveTo(x0, y0);

    // Draw bezier curves between control points
    for (let i = 0; i < controlPoints.length; i++) {
      const current = controlPoints[i];
      const next = controlPoints[(i + 1) % controlPoints.length];

      // Control point 1: current point's handleOut
      const cp1 = current.handleOut || { u: current.u, v: current.v };
      const {x: cp1x, y: cp1y} = worldToCanvas(cp1.u, cp1.v);

      // Control point 2: next point's handleIn
      const cp2 = next.handleIn || { u: next.u, v: next.v };
      const {x: cp2x, y: cp2y} = worldToCanvas(cp2.u, cp2.v);

      // End point: next point
      const {x: endX, y: endY} = worldToCanvas(next.u, next.v);

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
    }

    ctx.stroke();
  }

  /**
   * Draw onion skin (ghost outlines of adjacent profiles)
   */
  function drawOnionSkin() {
    if (!ctx) return;

    // Draw previous profile (semi-transparent gray)
    if (props.prevProfile) {
      ctx.strokeStyle = "rgba(128, 128, 128, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();

      const numPoints = props.prevProfile.length;
      for (let i = 0; i <= numPoints; i++) {
        const angle = (i % numPoints / numPoints) * Math.PI * 2;
        const radius = props.prevProfile[i % numPoints];
        const u = radius * Math.cos(angle);
        const v = radius * Math.sin(angle);
        const {x, y} = worldToCanvas(u, v);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Draw next profile (semi-transparent gray)
    if (props.nextProfile) {
      ctx.strokeStyle = "rgba(128, 128, 128, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();

      const numPoints = props.nextProfile.length;
      for (let i = 0; i <= numPoints; i++) {
        const angle = (i % numPoints / numPoints) * Math.PI * 2;
        const radius = props.nextProfile[i % numPoints];
        const u = radius * Math.cos(angle);
        const v = radius * Math.sin(angle);
        const {x, y} = worldToCanvas(u, v);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
  }

  /**
   * Draw control points and their tangent handles
   */
  function drawControlPoints() {
    if (!ctx) return;

    controlPoints.forEach((point, index) => {
      if (!ctx) return;

      const {x, y} = worldToCanvas(point.u, point.v);
      const isSelected = selectedPointIndices.has(index);

      // Draw tangent handles (gray lines) for ALL selected points
      if (isSelected && point.handleIn && point.handleOut) {
        ctx.strokeStyle = "#888888";
        ctx.lineWidth = 1;

        // Handle In
        const {x: inX, y: inY} = worldToCanvas(point.handleIn.u, point.handleIn.v);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(inX, inY);
        ctx.stroke();

        // Draw handle endpoint
        ctx.fillStyle = "#888888";
        ctx.beginPath();
        ctx.arc(inX, inY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Handle Out
        const {x: outX, y: outY} = worldToCanvas(point.handleOut.u, point.handleOut.v);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(outX, outY);
        ctx.stroke();

        // Draw handle endpoint
        ctx.fillStyle = "#888888";
        ctx.beginPath();
        ctx.arc(outX, outY, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw control point (blue dot)
      ctx.fillStyle = isSelected ? "#ffff00" : "#4444ff"; // Yellow if selected, blue otherwise
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Draw outline
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  /**
   * Mouse event handlers
   */
  function handleMouseDown(event: MouseEvent) {
    if (!canvasRef) return;

    const rect = canvasRef.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if clicking on a tangent handle (for any selected point)
    for (const selectedIndex of selectedPointIndices) {
      const point = controlPoints[selectedIndex];

      if (point.handleIn) {
        const {x: inX, y: inY} = worldToCanvas(point.handleIn.u, point.handleIn.v);
        const distIn = Math.sqrt((x - inX) ** 2 + (y - inY) ** 2);

        if (distIn < 8) {
          isDraggingHandle = true;
          selectedHandleType = 'in';
          // Store which point's handle we're dragging
          dragStartPoint = { u: selectedIndex, v: 0 }; // Use u field to store index
          render();
          return;
        }
      }

      if (point.handleOut) {
        const {x: outX, y: outY} = worldToCanvas(point.handleOut.u, point.handleOut.v);
        const distOut = Math.sqrt((x - outX) ** 2 + (y - outY) ** 2);

        if (distOut < 8) {
          isDraggingHandle = true;
          selectedHandleType = 'out';
          // Store which point's handle we're dragging
          dragStartPoint = { u: selectedIndex, v: 0 }; // Use u field to store index
          render();
          return;
        }
      }
    }

    // Check if clicking on a control point
    for (let i = 0; i < controlPoints.length; i++) {
      const point = controlPoints[i];
      const {x: px, y: py} = worldToCanvas(point.u, point.v);
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);

      if (dist < 10) {
        // Shift-click for multi-select (toggle)
        if (event.shiftKey) {
          if (selectedPointIndices.has(i)) {
            selectedPointIndices.delete(i);
          } else {
            selectedPointIndices.add(i);
          }
        } else {
          // Normal click - select only this point
          selectedPointIndices.clear();
          selectedPointIndices.add(i);
        }
        isDragging = true;
        render();
        return;
      }
    }

    // Click on empty space - deselect all
    selectedPointIndices.clear();
    render();
  }

  function handleMouseMove(event: MouseEvent) {
    if (!canvasRef) return;
    if (!isDragging && !isDraggingHandle) return;
    if (selectedPointIndices.size === 0) return;

    const rect = canvasRef.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const {u, v} = canvasToWorld(x, y);

    if (isDraggingHandle && selectedHandleType && dragStartPoint) {
      // Update tangent handle position for the specific point
      const pointIndex = Math.round(dragStartPoint.u); // Retrieve stored index
      const point = controlPoints[pointIndex];

      if (selectedHandleType === 'in' && point.handleIn) {
        point.handleIn = {u, v};
      } else if (selectedHandleType === 'out' && point.handleOut) {
        point.handleOut = {u, v};
      }
    } else if (isDragging) {
      // Move all selected points together
      // Calculate delta from the first selected point if we have one
      const firstSelectedIndex = Array.from(selectedPointIndices)[0];
      const firstPoint = controlPoints[firstSelectedIndex];

      const deltaU = u - firstPoint.u;
      const deltaV = v - firstPoint.v;

      // Move all selected points by the same delta
      for (const index of selectedPointIndices) {
        const point = controlPoints[index];

        point.u += deltaU;
        point.v += deltaV;

        // Move handles with the point
        if (point.handleIn) {
          point.handleIn.u += deltaU;
          point.handleIn.v += deltaV;
        }
        if (point.handleOut) {
          point.handleOut.u += deltaU;
          point.handleOut.v += deltaV;
        }
      }

      // Notify parent
      props.onProfileChange(controlPoints);
    }

    render();
  }

  function handleMouseUp() {
    isDragging = false;
    isDraggingHandle = false;
    selectedHandleType = null;
    dragStartPoint = null;
  }

  return (
    <div class="profile-editor">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
