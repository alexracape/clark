import { useEffect, useRef, useCallback } from "react";

/**
 * Animated particle graph that forms the word "Clark".
 *
 * Nodes start scattered across the canvas, connected by edges as a
 * knowledge-graph. After a delay they contract into the letterforms.
 * Mouse gently repels nearby particles.
 *
 * The `onSettled` callback fires once the text has formed, so the
 * parent can reveal the rest of the onboarding UI.
 */

const NODE_COLORS = [
  "#3D7A5F",
  "#2E6049",
  "#C9A84C",
  "#7EB8C9",
  "#81C784",
  "#7A6B52",
];

const EDGE_COLOR_R = 61;
const EDGE_COLOR_G = 122;
const EDGE_COLOR_B = 95;

/** How many px apart to sample text pixels (lower = more nodes). */
const SAMPLE_GAP = 5;
/** Max number of nodes to keep things smooth. */
const MAX_NODES = 600;
/** Each node connects to its K nearest neighbours (within the same letter). */
const KNN_K = 3;

// ── Helpers ────────────────────────────────────────────────

interface Node {
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  letter: number; // which letter this node belongs to
}

type Edge = [number, number];

/** Render "Clark" off-screen and return per-pixel target positions,
 *  each tagged with a letter index (0-4) so we can avoid cross-letter edges. */
function sampleTextTargets(
  w: number,
  h: number,
  yCenter: number,
): { x: number; y: number; letter: number }[] {
  const off = document.createElement("canvas");
  const ctx = off.getContext("2d")!;
  off.width = w;
  off.height = h;

  // Measure each letter individually to find its bounding range
  ctx.font = "bold 120px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const letters = ["C", "l", "a", "r", "k"];
  // First render the full word to get pixel positions
  ctx.fillStyle = "#000";
  ctx.fillText("Clark", w / 2, yCenter);

  // Measure character boundaries using measureText
  const fullMetrics = ctx.measureText("Clark");
  const fullWidth = fullMetrics.width;
  const startX = w / 2 - fullWidth / 2;

  // Get each letter's x-boundary
  const letterBounds: { left: number; right: number }[] = [];
  let cursor = 0;
  for (const ch of letters) {
    const charWidth = ctx.measureText(ch).width;
    letterBounds.push({
      left: startX + cursor,
      right: startX + cursor + charWidth,
    });
    cursor += charWidth;
  }

  const img = ctx.getImageData(0, 0, w, h);
  const pts: { x: number; y: number; letter: number }[] = [];

  for (let y = 0; y < h; y += SAMPLE_GAP) {
    for (let x = 0; x < w; x += SAMPLE_GAP) {
      if (img.data[(y * w + x) * 4 + 3] > 128) {
        // Determine which letter this pixel belongs to
        let letter = -1;
        for (let li = 0; li < letterBounds.length; li++) {
          if (x >= letterBounds[li].left && x < letterBounds[li].right) {
            letter = li;
            break;
          }
        }
        // Pixels in the gaps between letters — assign to nearest
        if (letter === -1) {
          let minDist = Infinity;
          for (let li = 0; li < letterBounds.length; li++) {
            const mid =
              (letterBounds[li].left + letterBounds[li].right) / 2;
            const d = Math.abs(x - mid);
            if (d < minDist) {
              minDist = d;
              letter = li;
            }
          }
        }
        pts.push({ x, y, letter });
      }
    }
  }
  return pts;
}

/** Build K-nearest-neighbour edges, only within the same letter group. */
function buildKNNEdges(nodes: Node[], k: number): Edge[] {
  const edges = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const dists: { j: number; d: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      if (nodes[i].letter !== nodes[j].letter) continue; // same letter only
      const dx = nodes[i].tx - nodes[j].tx;
      const dy = nodes[i].ty - nodes[j].ty;
      dists.push({ j, d: dx * dx + dy * dy });
    }
    dists.sort((a, b) => a.d - b.d);
    for (let n = 0; n < Math.min(k, dists.length); n++) {
      const lo = Math.min(i, dists[n].j);
      const hi = Math.max(i, dists[n].j);
      edges.add(`${lo},${hi}`);
    }
  }
  return [...edges].map((key) => {
    const [a, b] = key.split(",");
    return [+a, +b] as Edge;
  });
}

// ── Component ──────────────────────────────────────────────

interface ParticleGraphProps {
  /** Fire once the particles have settled into the word. */
  onSettled?: () => void;
  /** Vertical center of the text in 0-1 ratio of container height. */
  textYRatio?: number;
}

export function ParticleGraph({
  onSettled,
  textYRatio = 0.42,
}: ParticleGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stoppedRef = useRef(false);
  const settledFiredRef = useRef(false);

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;

    stoppedRef.current = false;
    settledFiredRef.current = false;

    const ctx = canvas.getContext("2d")!;
    const dpr = devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sample targets
    const yCenter = h * textYRatio;
    const allTargets = sampleTextTargets(w, h, yCenter);
    const step = Math.max(1, Math.floor(allTargets.length / MAX_NODES));

    const nodes: Node[] = [];
    for (let i = 0; i < allTargets.length; i += step) {
      const t = allTargets[i];
      const angle = Math.random() * Math.PI * 2;
      const dist = 100 + Math.random() * Math.max(w, h) * 0.45;
      nodes.push({
        x: w / 2 + Math.cos(angle) * dist,
        y: h / 2 + Math.sin(angle) * dist,
        tx: t.x,
        ty: t.y,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 1.5 + 1.2,
        color: NODE_COLORS[Math.floor(Math.random() * NODE_COLORS.length)],
        letter: t.letter,
      });
    }

    const edges = buildKNNEdges(nodes, KNN_K);

    // Mouse tracking
    const mouse = { x: -9999, y: -9999 };
    const onMouseMove = (e: MouseEvent) => {
      const r = container.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onMouseLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);

    let phase = 0; // 0=scatter, 1=contracting, 2=settled
    let t = 0;

    const contractTimer = setTimeout(() => {
      phase = 1;
    }, 2200);

    function frame() {
      if (stoppedRef.current) return;
      ctx.fillStyle = "#FAF6EE";
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 0.8;
      t++;

      for (const n of nodes) {
        if (phase >= 1) {
          const dx = n.tx - n.x;
          const dy = n.ty - n.y;
          const springK =
            phase === 1 ? Math.min(0.003 + t * 0.00003, 0.05) : 0.05;
          n.vx += dx * springK;
          n.vy += dy * springK;
          n.vx *= 0.9;
          n.vy *= 0.9;
        } else {
          n.vx += (Math.random() - 0.5) * 0.02;
          n.vy += (Math.random() - 0.5) * 0.02;
          n.vx *= 0.995;
          n.vy *= 0.995;
        }

        // Gentle mouse repulsion
        const mdx = n.x - mouse.x;
        const mdy = n.y - mouse.y;
        const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mDist < 80 && mDist > 0) {
          const force = ((80 - mDist) / 80) * 1.5;
          n.vx += (mdx / mDist) * force;
          n.vy += (mdy / mDist) * force;
        }

        n.x += n.vx;
        n.y += n.vy;
      }

      // Check settled
      if (phase === 1 && !settledFiredRef.current) {
        let settled = 0;
        for (const n of nodes) {
          if (Math.abs(n.x - n.tx) + Math.abs(n.y - n.ty) < 4) settled++;
        }
        if (settled > nodes.length * 0.8) {
          phase = 2;
          settledFiredRef.current = true;
          onSettledRef.current?.();
        }
      }

      // Draw edges
      for (const [i, j] of edges) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const maxDist = phase < 1 ? 250 : 150;
        const alpha =
          Math.max(0, 1 - d / maxDist) * (phase < 1 ? 0.12 : 0.25);
        if (alpha > 0.005) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${EDGE_COLOR_R}, ${EDGE_COLOR_G}, ${EDGE_COLOR_B}, ${alpha})`;
          ctx.stroke();
        }
      }

      // Draw nodes
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
      }

      requestAnimationFrame(frame);
    }

    // Double-rAF: let the browser settle before first paint
    requestAnimationFrame(() => requestAnimationFrame(frame));

    // Cleanup
    return () => {
      stoppedRef.current = true;
      clearTimeout(contractTimer);
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [textYRatio]);

  useEffect(() => {
    let cleanup = init();
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!container) return cleanup;

    let lastW = container.getBoundingClientRect().width;
    let lastH = container.getBoundingClientRect().height;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (Math.abs(width - lastW) > 5 || Math.abs(height - lastH) > 5) {
        lastW = width;
        lastH = height;
        cleanup?.();
        cleanup = init();
      }
    });
    observer.observe(container);

    return () => {
      cleanup?.();
      observer.disconnect();
    };
  }, [init]);

  return <canvas ref={canvasRef} className="particle-graph-canvas" />;
}
