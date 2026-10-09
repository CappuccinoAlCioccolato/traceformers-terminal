import { useEffect, useRef } from "react";
import { buildGraph, nodeTouchesFocus, type GraphNode } from "@/lib/protocol/derive";
import type { Registry } from "@/lib/protocol/types";

const YOU = "#ff3b3b";

type Body = GraphNode & { x: number; y: number; vx: number; vy: number; r: number };

const KIND_VAR: Record<GraphNode["kind"], string> = {
  character: "--color-node-character",
  base: "--color-node-base",
  encoder: "--color-node-encoder",
  wallet: "--color-node-wallet",
};

function readColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#f0f0f0";
}

function radius(node: GraphNode): number {
  if (node.kind === "character") return Math.min(13, 5 + Math.sqrt(node.points) * 1.1);
  if (node.kind === "wallet") return 5;
  return 8;
}

export function GraphCanvas({
  registry,
  focus,
  selected,
  wallet,
  onSelect,
}: {
  registry: Registry;
  focus: string | null;
  selected: string | null;
  wallet: string | null;
  onSelect: (id: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const bodies = useRef<Map<string, Body>>(new Map());
  const drag = useRef<{ id: string; pointer: number; moved: boolean } | null>(null);
  const pan = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const focusRef = useRef(focus);
  const selectedRef = useRef(selected);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  focusRef.current = focus;
  selectedRef.current = selected;
  const graphRef = useRef(buildGraph(registry));
  graphRef.current = buildGraph(registry);
  const registryRef = useRef(registry);
  registryRef.current = registry;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ns = "http://www.w3.org/2000/svg";
    let alive = true;
    let frame = 0;

    const layout = () => {
      const rect = svg.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(svg);

    const seed = () => {
      const { nodes } = graphRef.current;
      const rect = svg.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const buckets: Record<GraphNode["kind"], GraphNode[]> = {
        character: [],
        base: [],
        encoder: [],
        wallet: [],
      };
      for (const node of nodes) buckets[node.kind].push(node);
      const ring = { character: 0.18, base: 0.34, encoder: 0.48, wallet: 0.64 };
      (Object.keys(buckets) as GraphNode["kind"][]).forEach((kind) => {
        buckets[kind].forEach((node, index) => {
          const prev = bodies.current.get(node.id);
          if (prev) {
            bodies.current.set(node.id, { ...node, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, r: radius(node) });
            return;
          }
          const angle = (index / Math.max(1, buckets[kind].length)) * Math.PI * 2 - Math.PI / 2;
          const dist = Math.min(rect.width, rect.height) * ring[kind];
          bodies.current.set(node.id, {
            ...node,
            x: cx + Math.cos(angle) * dist,
            y: cy + Math.sin(angle) * dist * 0.72,
            vx: 0,
            vy: 0,
            r: radius(node),
          });
        });
      });
      for (const id of [...bodies.current.keys()]) {
        if (!nodes.some((node) => node.id === id)) bodies.current.delete(id);
      }
    };

    const step = () => {
      seed();
      const list = [...bodies.current.values()];
      const rect = svg.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]!;
          const b = list[j]!;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy) || 0.01;
          const min = a.r + b.r + 36;
          const force = (dist < min ? 1800 : 1400) / (dist * dist);
          if (dist < min) dist = min;
          dx /= dist;
          dy /= dist;
          if (drag.current?.id !== a.id) {
            a.vx -= dx * force;
            a.vy -= dy * force;
          }
          if (drag.current?.id !== b.id) {
            b.vx += dx * force;
            b.vy += dy * force;
          }
        }
      }
      for (const edge of graphRef.current.edges) {
        const a = bodies.current.get(edge.source);
        const b = bodies.current.get(edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const rest = 92 + a.r + b.r;
        const force = (dist - rest) * 0.01 * Math.min(2, edge.weight);
        if (drag.current?.id !== a.id) {
          a.vx += (dx / dist) * force;
          a.vy += (dy / dist) * force;
        }
        if (drag.current?.id !== b.id) {
          b.vx -= (dx / dist) * force;
          b.vy -= (dy / dist) * force;
        }
      }
      for (const body of list) {
        if (drag.current?.id === body.id) continue;
        body.vx += (cx - body.x) * 0.003;
        body.vy += (cy - body.y) * 0.003;
        body.vx *= 0.76;
        body.vy *= 0.76;
        body.x += body.vx;
        body.y += body.vy;
      }
    };

    const draw = () => {
      const colors = {
        character: readColor(KIND_VAR.character),
        base: readColor(KIND_VAR.base),
        encoder: readColor(KIND_VAR.encoder),
        wallet: readColor(KIND_VAR.wallet),
        fg: "#f0f0f0",
        dim: "#949494",
      };
      const { x: ox, y: oy, k } = view.current;
      const project = (x: number, y: number) => ({ x: x * k + ox, y: y * k + oy });
      const live = (id: string) => nodeTouchesFocus(id, graphRef.current.edges, focusRef.current);
      const layer = svg.querySelector("g") ?? svg.appendChild(document.createElementNS(ns, "g"));
      layer.replaceChildren();
      for (const edge of graphRef.current.edges) {
        const a = bodies.current.get(edge.source);
        const b = bodies.current.get(edge.target);
        if (!a || !b) continue;
        const on = live(a.id) && live(b.id);
        const pa = project(a.x, a.y);
        const pb = project(b.x, b.y);
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", String(pa.x));
        line.setAttribute("y1", String(pa.y));
        line.setAttribute("x2", String(pb.x));
        line.setAttribute("y2", String(pb.y));
        line.setAttribute("stroke", on ? (edge.kind === "reply" ? "rgba(248,3,124,0.7)" : "rgba(240,240,240,0.32)") : "rgba(240,240,240,0.06)");
        if (edge.kind === "custody") line.setAttribute("stroke-dasharray", "2 4");
        line.setAttribute("stroke-width", on ? String(Math.min(2.4, 0.7 + edge.weight * 0.35)) : "0.6");
        layer.appendChild(line);
      }
      for (const body of bodies.current.values()) {
        const on = live(body.id);
        const p = project(body.x, body.y);
        const r = body.r * k;
        const group = document.createElementNS(ns, "g");
        group.setAttribute("opacity", on ? "1" : "0.16");
        const shape = body.kind === "wallet"
          ? document.createElementNS(ns, "polygon")
          : document.createElementNS(ns, "circle");
        if (body.kind === "wallet") {
          shape.setAttribute("points", `${p.x},${p.y - r} ${p.x + r},${p.y} ${p.x},${p.y + r} ${p.x - r},${p.y}`);
        } else {
          shape.setAttribute("cx", String(p.x));
          shape.setAttribute("cy", String(p.y));
          shape.setAttribute("r", String(r));
        }
        const yours = walletRef.current && (body.address === walletRef.current || registryRef.current.assets.some((asset) => asset.id === body.id && asset.owner === walletRef.current));
        shape.setAttribute("fill", body.kind === "wallet" && yours ? YOU : colors[body.kind]);
        if (selectedRef.current === body.id || yours) {
          shape.setAttribute("stroke", yours ? YOU : colors.fg);
          shape.setAttribute("stroke-width", yours ? "2" : "1.5");
        }
        group.appendChild(shape);
        const showLabel = on && (body.kind !== "wallet" || selectedRef.current === body.id || Boolean(focusRef.current));
        if (showLabel) {
          const text = document.createElementNS(ns, "text");
          text.setAttribute("x", String(p.x));
          text.setAttribute("y", String(p.y + r + 14));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("fill", body.kind === "character" ? colors.fg : colors.dim);
          text.setAttribute("font-size", body.kind === "character" ? "12" : "10");
          text.setAttribute("font-family", "'IBM Plex Mono', monospace");
          text.textContent = body.label;
          group.appendChild(text);
        }
        layer.appendChild(group);
      }
    };

    const loop = () => {
      if (!alive) return;
      step();
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const worldPoint = (event: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const { x: ox, y: oy, k } = view.current;
      return {
        x: (event.clientX - rect.left - ox) / k,
        y: (event.clientY - rect.top - oy) / k,
      };
    };
    const hit = (x: number, y: number) => {
      let found: Body | null = null;
      for (const body of bodies.current.values()) {
        if (Math.hypot(body.x - x, body.y - y) <= body.r + 8) found = body;
      }
      return found;
    };
    const onDown = (event: PointerEvent) => {
      const point = worldPoint(event);
      const body = hit(point.x, point.y);
      svg.setPointerCapture(event.pointerId);
      if (body) drag.current = { id: body.id, pointer: event.pointerId, moved: false };
      else pan.current = { x: view.current.x, y: view.current.y, px: event.clientX, py: event.clientY, moved: false };
    };
    const onMove = (event: PointerEvent) => {
      if (drag.current) {
        const body = bodies.current.get(drag.current.id);
        if (!body) return;
        const point = worldPoint(event);
        if (Math.hypot(point.x - body.x, point.y - body.y) > 3) drag.current.moved = true;
        body.x = point.x;
        body.y = point.y;
        body.vx = 0;
        body.vy = 0;
      } else if (pan.current) {
        if (Math.hypot(event.clientX - pan.current.px, event.clientY - pan.current.py) > 3) pan.current.moved = true;
        view.current.x = pan.current.x + (event.clientX - pan.current.px);
        view.current.y = pan.current.y + (event.clientY - pan.current.py);
      }
    };
    const onUp = () => {
      if (drag.current && !drag.current.moved) {
        onSelect(drag.current.id);
      } else if (pan.current && !pan.current.moved) onSelect(null);
      drag.current = null;
      pan.current = null;
    };

    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
    };
  }, [onSelect]);

  return (
    <svg
      ref={svgRef}
      className="graph-svg"
      role="img"
      aria-label="Conversation graph"
    />
  );
}
