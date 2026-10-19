import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Search, Shuffle } from "lucide-react";
import { useTicketsStore } from "../../store/tickets";
import { useI18n } from "../../lib/i18n";
import type { GraphEdge, GraphNode } from "../../types/graph";
import type { TicketStatus } from "../../types/ticket";

/**
 * Obsidian-style force-directed ticket graph.
 *
 * The layout is a small hand-rolled force simulation (pairwise repulsion +
 * link springs + centering) instead of a physics dependency: graphs here are
 * tens of tickets, so this stays fast and keeps the bundle free of a library.
 * Tickets with no links are pushed onto an outer ring, the way Obsidian parks
 * its unlinked nodes.
 */

// Layout space. The SVG renders in CSS pixels and only the inner <g> is
// transformed, so these are "virtual" coordinates the sim works in.
const VIRTUAL_W = 1000;
const VIRTUAL_H = 700;
const REPULSION = 6000;
const SPRING_K = 0.02;
const SPRING_LEN = 110;
const CENTER_K = 0.004;
const RING_K = 0.02;
const RING_RADIUS = 320;
const DAMPING = 0.85;
const MAX_TICKS = 600;
const MIN_ENERGY = 0.05;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

const STATUS_COLOR: Record<TicketStatus, string> = {
  backlog: "var(--status-backlog)",
  "in-progress": "var(--status-progress)",
  review: "var(--status-review)",
  done: "var(--status-done)",
  archived: "var(--status-archived)",
};

interface SimNode extends GraphNode {
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
}

function createNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  seed?: Map<string, { x: number; y: number }>,
): SimNode[] {
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const total = Math.max(1, nodes.length);
  return nodes.map((node, i) => {
    const prev = seed?.get(node.id);
    // Deterministic ring seed — avoids the jitter of random start positions.
    const angle = (i / total) * Math.PI * 2;
    const radius = 120 + (i % 5) * 30;
    return {
      ...node,
      degree: degree.get(node.id) ?? 0,
      x: prev?.x ?? VIRTUAL_W / 2 + Math.cos(angle) * radius,
      y: prev?.y ?? VIRTUAL_H / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      pinned: false,
    };
  });
}

/** Advance the simulation one step. Returns the total kinetic energy. */
function step(
  nodes: SimNode[],
  edges: GraphEdge[],
  byId: Map<string, SimNode>,
): number {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        // Perfectly overlapping nodes would divide by zero; nudge them apart.
        dx = (i % 3) - 1;
        dy = (j % 3) - 1;
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      const f = REPULSION / d2;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - SPRING_LEN) * SPRING_K;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  const cx = VIRTUAL_W / 2;
  const cy = VIRTUAL_H / 2;
  for (const n of nodes) {
    n.vx += (cx - n.x) * CENTER_K;
    n.vy += (cy - n.y) * CENTER_K;
    if (n.degree === 0) {
      const dx = n.x - cx;
      const dy = n.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const push = (d - RING_RADIUS) * RING_K;
      n.vx += (dx / d) * push;
      n.vy += (dy / d) * push;
    }
  }

  let energy = 0;
  for (const n of nodes) {
    if (n.pinned) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    n.x += n.vx;
    n.y += n.vy;
    energy += n.vx * n.vx + n.vy * n.vy;
  }
  return energy;
}

interface GraphViewProps {
  onOpenTicket: (filename: string) => void;
}

export function GraphView({ onOpenTicket }: GraphViewProps) {
  const { t } = useI18n();
  const graph = useTicketsStore((s) => s.graph);
  const loadGraph = useTicketsStore((s) => s.loadGraph);

  const [query, setQuery] = useState("");
  const [showOrphans, setShowOrphans] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Bumped by the animation loop so the SVG re-renders mutated positions.
  const [frame, setFrame] = useState(0);

  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const draggingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  const runSim = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    let ticks = 0;

    const frameStep = () => {
      const nodes = nodesRef.current;
      if (nodes.length === 0) {
        runningRef.current = false;
        rafRef.current = null;
        return;
      }
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const energy = step(nodes, edgesRef.current, byId);
      ticks += 1;
      setFrame((f) => f + 1);
      const settled = ticks > MAX_TICKS || energy / nodes.length < MIN_ENERGY;
      if (!draggingRef.current && settled) {
        runningRef.current = false;
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(frameStep);
    };

    rafRef.current = requestAnimationFrame(frameStep);
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    if (!graph) return;
    // Re-seed from current positions so a refresh does not reshuffle the map.
    const seed = new Map(
      nodesRef.current.map((n) => [n.id, { x: n.x, y: n.y }]),
    );
    nodesRef.current = createNodes(
      graph.nodes,
      graph.edges,
      seed.size > 0 ? seed : undefined,
    );
    edgesRef.current = graph.edges;
    setFrame((f) => f + 1);
    runSim();
  }, [graph, runSim]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
    },
    [],
  );

  // Center the layout once the canvas has been measured.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPan({
      x: rect.width / 2 - VIRTUAL_W / 2,
      y: rect.height / 2 - VIRTUAL_H / 2,
    });
  }, []);

  // Wheel zoom needs a non-passive listener, so it is bound natively.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const current = zoomRef.current;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, current * Math.exp(-e.deltaY * 0.0015)),
      );
      const k = next / current;
      setPan((p) => ({ x: mx - (mx - p.x) * k, y: my - (my - p.y) * k }));
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toVirtual = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  const dragRef = useRef<{
    mode: "node" | "pan";
    id?: string;
    startX: number;
    startY: number;
    moved: boolean;
    panX: number;
    panY: number;
  } | null>(null);

  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) node.pinned = true;
    draggingRef.current = true;
    dragRef.current = {
      mode: "node",
      id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      panX: pan.x,
      panY: pan.y,
    };
    runSim();
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

    if (drag.mode === "pan") {
      setPan({ x: drag.panX + dx, y: drag.panY + dy });
      return;
    }
    const node = nodesRef.current.find((n) => n.id === drag.id);
    if (!node) return;
    const p = toVirtual(e.clientX, e.clientY);
    node.x = p.x;
    node.y = p.y;
    node.vx = 0;
    node.vy = 0;
    setFrame((f) => f + 1);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.mode === "node") {
      draggingRef.current = false;
      const node = nodesRef.current.find((n) => n.id === drag.id);
      if (node) node.pinned = false;
      // A click without movement opens the ticket; a drag just repositions it.
      if (!drag.moved) {
        const target = nodesRef.current.find((n) => n.id === drag.id);
        if (target) onOpenTicket(target.filename);
      }
      return;
    }
    if (!drag.moved) setHoverId(null);
  };

  const relayout = () => {
    if (!graph) return;
    nodesRef.current = createNodes(graph.nodes, graph.edges);
    setZoom(1);
    const el = svgRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPan({
        x: rect.width / 2 - VIRTUAL_W / 2,
        y: rect.height / 2 - VIRTUAL_H / 2,
      });
    }
    setFrame((f) => f + 1);
    runSim();
  };

  const edges = graph?.edges ?? [];

  const visible = useMemo(() => {
    void frame; // positions mutate in place; re-filter as the sim advances
    const q = query.trim().toLowerCase();
    return nodesRef.current.filter((n) => {
      if (!showOrphans && n.degree === 0) return false;
      if (q === "") return true;
      return (
        n.id.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [query, showOrphans, frame]);

  const visibleIds = useMemo(
    () => new Set(visible.map((n) => n.id)),
    [visible],
  );

  const hoverNeighbors = useMemo(() => {
    const set = new Set<string>();
    if (!hoverId) return set;
    for (const e of edges) {
      if (e.source === hoverId) set.add(e.target);
      if (e.target === hoverId) set.add(e.source);
    }
    return set;
  }, [edges, hoverId]);

  const isEmpty = !graph || graph.nodes.length === 0;

  return (
    <div className="graph-root">
      <div className="graph-toolbar">
        <label className="graph-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={t.misc.graph.filterPlaceholder}
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowOrphans((v) => !v)}
          title={
            showOrphans ? t.misc.graph.hideUnlinked : t.misc.graph.showUnlinked
          }
          aria-pressed={!showOrphans}
        >
          {showOrphans ? <Eye size={14} /> : <EyeOff size={14} />}
          {t.misc.graph.unlinked}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={relayout}
          title={t.misc.graph.relayoutHint}
        >
          <Shuffle size={14} />
          {t.misc.graph.relayout}
        </button>
        <span className="graph-count">
          {t.misc.graph.counts(visible.length, edges.length)}
        </span>
      </div>

      {isEmpty ? (
        <div className="graph-empty">
          <p className="font-mono text-lg font-bold text-fg">
            {t.misc.graph.emptyTitle}
          </p>
          <p className="text-fg-muted text-sm">
            {t.misc.graph.emptyHintPrefix}{" "}
            <span className="font-mono text-fg">
              links: [TKT-1041]
            </span>{" "}
            {t.misc.graph.emptyHintSuffix}
          </p>
        </div>
      ) : (
        <svg
          ref={svgRef}
          className="graph-canvas"
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="application"
          aria-label={t.misc.graph.canvasAria}
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {edges.map((e) => {
              const a = nodesRef.current.find((n) => n.id === e.source);
              const b = nodesRef.current.find((n) => n.id === e.target);
              if (!a || !b) return null;
              if (!visibleIds.has(a.id) || !visibleIds.has(b.id)) return null;
              const active =
                hoverId !== null && (e.source === hoverId || e.target === hoverId);
              return (
                <line
                  key={`${e.source}-${e.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? "var(--accent)" : "var(--border-strong)"}
                  strokeWidth={(active ? 1.8 : 1) / zoom}
                  strokeOpacity={hoverId && !active ? 0.25 : 0.7}
                />
              );
            })}

            {visible.map((n) => {
              const radius = 5 + Math.min(9, Math.sqrt(n.degree) * 3);
              const dimmed = hoverId !== null && n.id !== hoverId &&
                !hoverNeighbors.has(n.id);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x} ${n.y})`}
                  className="graph-node"
                  style={{ cursor: "grab", opacity: dimmed ? 0.3 : 1 }}
                  onPointerDown={(e) => onNodePointerDown(e, n.id)}
                  onPointerEnter={() => setHoverId(n.id)}
                  onPointerLeave={() => setHoverId(null)}
                >
                  <circle
                    r={radius}
                    fill={STATUS_COLOR[n.status] ?? "var(--status-backlog)"}
                    stroke="var(--bg)"
                    strokeWidth={1.5 / zoom}
                  />
                  <text
                    className="graph-label"
                    x={radius + 4}
                    y={3}
                    fontSize={10 / zoom}
                    fill="var(--fg-muted)"
                  >
                    {n.id}
                  </text>
                  {hoverId === n.id ? (
                    <text
                      className="graph-label"
                      x={radius + 4}
                      y={16}
                      fontSize={10 / zoom}
                      fill="var(--fg-subtle)"
                    >
                      {n.title.length > 42
                        ? `${n.title.slice(0, 42)}…`
                        : n.title}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
