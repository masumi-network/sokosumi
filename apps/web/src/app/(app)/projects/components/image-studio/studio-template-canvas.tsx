"use client";

import { Pause, Play } from "lucide-react";
import Image from "next/image";
import { type PointerEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";

import { STUDIO_TEMPLATES, type StudioTemplate } from "./studio-templates";
import type { StudioLabels } from "./types";

const TILES = [
  [-0.04, 0.05, 4, 12, true],
  [0.14, 0.13, 0, 10, false],
  [0.36, 0.06, 3, 13, true],
  [0.58, 0.12, 4, 17, false],
  [0.83, 0.1, 2, 16, false],
  [1.02, 0.16, 1, 10, true],
  [0.07, 0.45, 1, 14, false],
  [0.25, 0.42, 2, 11, true],
  [0.45, 0.47, 0, 9, true],
  [0.72, 0.38, 1, 10, true],
  [0.93, 0.48, 3, 13, false],
  [-0.03, 0.77, 0, 9, true],
  [0.15, 0.85, 2, 12, true],
  [0.32, 0.88, 4, 17, false],
  [0.56, 0.83, 3, 13, false],
  [0.74, 0.86, 0, 10, true],
  [0.9, 0.89, 1, 15, false],
] as const;

const WRAP_MARGIN = 156;
const DRAG_THRESHOLD = 6;

function wrap(value: number, size: number) {
  const period = size + WRAP_MARGIN * 2;
  return ((((value + WRAP_MARGIN) % period) + period) % period) - WRAP_MARGIN;
}

interface Drag {
  id: number;
  x: number;
  y: number;
  tile: number;
  moved: boolean;
}

export function StudioTemplateCanvas({
  labels,
  onApplyTemplate,
}: {
  labels: StudioLabels;
  onApplyTemplate: (template: StudioTemplate) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<(HTMLDivElement | null)[]>([]);
  const offset = useRef({ x: 0, y: 0 });
  const size = useRef({ width: 0, height: 0 });
  const drag = useRef<Drag | null>(null);
  const [paused, setPaused] = useState(false);

  function paint() {
    const { width, height } = size.current;
    // On phones, crop into the same arrangement to leave space between cards.
    const sceneWidth = Math.max(width, 660);
    const sceneHeight = Math.max(height, 540);
    const sceneLeft = (width - sceneWidth) / 2;
    const sceneTop = (height - sceneHeight) / 2;

    TILES.forEach(([x, y], index) => {
      const tile = tilesRef.current[index];
      if (!tile) return;
      const left =
        sceneLeft + wrap(x * sceneWidth + offset.current.x, sceneWidth);
      const top =
        sceneTop + wrap(y * sceneHeight + offset.current.y, sceneHeight);
      tile.style.transform = `translate3d(${left - x * width}px, ${top - y * height}px, 0)`;
    });
  }

  function pan(x: number, y: number) {
    offset.current.x += x;
    offset.current.y += y;
    paint();
  }

  useMountEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      size.current = { width: canvas.clientWidth, height: canvas.clientHeight };
      paint();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || drag.current) return;
      event.preventDefault();
      const factor =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? size.current.height
            : 1;
      pan(-event.deltaX * factor, -event.deltaY * factor);
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener("wheel", handleWheel);
    };
  });

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return;
    const tile =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-studio-tile]")
        : null;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      tile: tile ? Number(tile.dataset.studioTile) : -1,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.dataset.interacting = "";
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    const x = event.clientX - current.x;
    const y = event.clientY - current.y;
    if (!current.moved && Math.hypot(x, y) < DRAG_THRESHOLD) return;
    current.moved = true;
    current.x = event.clientX;
    current.y = event.clientY;
    event.currentTarget.dataset.dragging = "";
    pan(x, y);
  }

  function clearDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return null;
    drag.current = null;
    delete event.currentTarget.dataset.interacting;
    delete event.currentTarget.dataset.dragging;
    return current;
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = clearDrag(event);
    if (!current || current.moved) return;
    const distance = Math.hypot(
      event.clientX - current.x,
      event.clientY - current.y,
    );
    const tile = TILES[current.tile];
    if (distance < DRAG_THRESHOLD && tile)
      onApplyTemplate(STUDIO_TEMPLATES[tile[2]]);
  }

  return (
    <>
      {/* The composer's template menu exposes each brief once to keyboard and screen reader users. */}
      <div
        aria-hidden="true"
        className="group/canvas bg-card-background absolute inset-0 -z-10 cursor-grab touch-pinch-zoom overflow-hidden select-none data-dragging:cursor-grabbing"
        data-paused={paused}
        data-studio-canvas=""
        onLostPointerCapture={clearDrag}
        onPointerCancel={clearDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={canvasRef}
      >
        {TILES.map(([x, y, templateIndex, width, distant], index) => {
          const template = STUDIO_TEMPLATES[templateIndex];
          const aspectRatio = template.aspectRatio.replace(":", " / ");
          return (
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2"
              data-studio-tile={index}
              key={`${x}:${y}`}
              ref={(node) => {
                tilesRef.current[index] = node;
              }}
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `clamp(5rem, ${width * 0.95}vw, ${width}rem)`,
              }}
            >
              <div
                className={cn(
                  "border-border bg-background motion-safe:animate-studio-template-float group-data-interacting/canvas:[animation-play-state:paused] group-data-[paused=true]/canvas:[animation-play-state:paused] relative overflow-hidden rounded-xl border motion-safe:hover:[animation-play-state:paused]",
                  distant
                    ? "opacity-55 hover:opacity-100"
                    : "opacity-90 hover:opacity-100",
                )}
                style={{
                  aspectRatio,
                  animationDelay: `${-index * 1.9}s`,
                  animationDuration: `${11 + (index % 5) * 2}s`,
                }}
              >
                <Image
                  alt=""
                  className="pointer-events-none object-cover"
                  draggable={false}
                  fill
                  sizes={`(max-width: 640px) 80px, ${width * 0.95}vw`}
                  src={`/studio/templates/${template.id}.jpg`}
                />
              </div>
            </div>
          );
        })}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--card-background)_15%,transparent_71%)]" />
      </div>
      <Button
        aria-label={
          paused ? labels.resumeTemplateMotion : labels.pauseTemplateMotion
        }
        className="absolute end-3 bottom-3 z-10 motion-reduce:hidden md:end-5 md:bottom-5"
        onClick={() => setPaused((value) => !value)}
        size="icon"
        type="button"
        variant="outline"
      >
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
      </Button>
    </>
  );
}
