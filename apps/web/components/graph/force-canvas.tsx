"use client";

import { useEffect, useRef } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";

export interface CanvasNode {
  id: string;
  label: string;
  color: string;
  radius: number;
  ring: "focus" | "selected" | "cycle" | null;
  dimmed: boolean;
  emphasized: boolean;
}

export interface CanvasLink {
  source: string;
  target: string;
  typeOnly: boolean;
  emphasized: boolean;
}

const RING_COLORS: Record<NonNullable<CanvasNode["ring"]>, string> = {
  focus: "oklch(0.72 0.17 293)",
  selected: "oklch(0.97 0.005 286)",
  cycle: "oklch(0.65 0.21 22)",
};

export default function ForceCanvas({
  nodes,
  links,
  width,
  height,
  dimLinks,
  onSelect,
  onFocus,
}: {
  nodes: CanvasNode[];
  links: CanvasLink[];
  width: number;
  height: number;
  dimLinks: boolean;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
}) {
  const graphRef = useRef<
    ForceGraphMethods<NodeObject<CanvasNode>, LinkObject<CanvasNode, CanvasLink>> | undefined
  >(undefined);
  const lastClick = useRef<{ id: string; at: number } | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    fitted.current = false;
    graphRef.current?.d3ReheatSimulation();
  }, [nodes.length]);

  return (
    <ForceGraph2D<CanvasNode, CanvasLink>
      ref={graphRef}
      graphData={{ nodes, links }}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      cooldownTicks={180}
      d3VelocityDecay={0.32}
      onEngineStop={() => {
        if (fitted.current) return;
        fitted.current = true;
        graphRef.current?.zoomToFit(400, 80);
      }}
      nodeLabel={(node) => node.id}
      nodeCanvasObject={(node, context, scale) => {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        context.globalAlpha = node.dimmed ? 0.18 : 1;
        context.beginPath();
        context.arc(x, y, node.radius, 0, 2 * Math.PI);
        context.fillStyle = node.color;
        context.fill();
        if (node.ring) {
          context.lineWidth = 2 / scale;
          context.strokeStyle = RING_COLORS[node.ring];
          context.stroke();
        }
        if (node.emphasized || scale > 2.2) {
          const fontSize = Math.max(10 / scale, 1.5);
          context.font = `${fontSize}px ui-monospace, monospace`;
          context.textAlign = "center";
          context.textBaseline = "top";
          context.fillStyle = "oklch(0.92 0.005 286)";
          context.fillText(node.label, x, y + node.radius + 2 / scale);
        }
        context.globalAlpha = 1;
      }}
      nodePointerAreaPaint={(node, color, context) => {
        context.beginPath();
        context.arc(node.x ?? 0, node.y ?? 0, node.radius + 2, 0, 2 * Math.PI);
        context.fillStyle = color;
        context.fill();
      }}
      linkColor={(link) =>
        link.emphasized
          ? "oklch(0.72 0.17 293 / 0.85)"
          : dimLinks
            ? "oklch(1 0 0 / 0.04)"
            : "oklch(1 0 0 / 0.14)"
      }
      linkWidth={(link) => (link.emphasized ? 1.6 : 0.6)}
      linkLineDash={(link) => (link.typeOnly ? [2, 2] : null)}
      linkDirectionalArrowLength={(link) => (link.emphasized ? 4 : 2.5)}
      linkDirectionalArrowRelPos={0.92}
      onNodeClick={(node) => {
        const id = String(node.id);
        const now = Date.now();
        if (lastClick.current?.id === id && now - lastClick.current.at < 350) onFocus(id);
        else onSelect(id);
        lastClick.current = { id, at: now };
      }}
      onBackgroundClick={() => onSelect(null)}
    />
  );
}
