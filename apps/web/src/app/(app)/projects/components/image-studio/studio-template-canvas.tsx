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
  {
    x: -0.04,
    y: 0.05,
    templateIndex: 4,
    width: 12,
    distant: true,
    src: "/studio/empty-ads/daybreak-oats.webp",
  },
  {
    x: 0.14,
    y: 0.13,
    templateIndex: 0,
    width: 10,
    distant: false,
    src: "/studio/empty-ads/lumen-sip.webp",
  },
  {
    x: 0.36,
    y: 0.06,
    templateIndex: 3,
    width: 13,
    distant: true,
    src: "/studio/empty-ads/sable-ink.webp",
  },
  {
    x: 0.58,
    y: 0.12,
    templateIndex: 4,
    width: 17,
    distant: false,
    src: "/studio/empty-ads/ridge-and-river.webp",
  },
  {
    x: 0.83,
    y: 0.1,
    templateIndex: 2,
    width: 16,
    distant: false,
    src: "/studio/empty-ads/ledgerly.webp",
  },
  {
    x: 1.02,
    y: 0.16,
    templateIndex: 1,
    width: 10,
    distant: true,
    src: "/studio/empty-ads/northbench-coffee.webp",
  },
  {
    x: 0.07,
    y: 0.45,
    templateIndex: 1,
    width: 14,
    distant: false,
    src: "/studio/empty-ads/fieldstep-sneakers.webp",
  },
  {
    x: 0.25,
    y: 0.42,
    templateIndex: 2,
    width: 11,
    distant: true,
    src: "/studio/empty-ads/solara-routes.webp",
  },
  {
    x: 0.45,
    y: 0.47,
    templateIndex: 0,
    width: 9,
    distant: true,
    src: "/studio/empty-ads/nimbus-air.webp",
  },
  {
    x: 0.72,
    y: 0.38,
    templateIndex: 1,
    width: 10,
    distant: true,
    src: "/studio/empty-ads/cedar-volt.webp",
  },
  {
    x: 0.93,
    y: 0.48,
    templateIndex: 3,
    width: 13,
    distant: false,
    src: "/studio/empty-ads/aero-loom.webp",
  },
  {
    x: -0.03,
    y: 0.77,
    templateIndex: 0,
    width: 9,
    distant: true,
    src: "/studio/empty-ads/bramble-rye.webp",
  },
  {
    x: 0.15,
    y: 0.85,
    templateIndex: 2,
    width: 12,
    distant: true,
    src: "/studio/empty-ads/kite-and-kiln.webp",
  },
  {
    x: 0.32,
    y: 0.88,
    templateIndex: 4,
    width: 17,
    distant: false,
    src: "/studio/empty-ads/cinder-cycle.webp",
  },
  {
    x: 0.56,
    y: 0.83,
    templateIndex: 3,
    width: 13,
    distant: false,
    src: "/studio/empty-ads/parcelly.webp",
  },
  {
    x: 0.74,
    y: 0.86,
    templateIndex: 0,
    width: 10,
    distant: true,
    src: "/studio/empty-ads/paloma-skin.webp",
  },
  {
    x: 0.9,
    y: 0.89,
    templateIndex: 1,
    width: 15,
    distant: false,
    src: "/studio/empty-ads/fern-and-co.webp",
  },
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

    TILES.forEach(({ x, y }, index) => {
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
      onApplyTemplate(STUDIO_TEMPLATES[tile.templateIndex]);
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
        {TILES.map(({ x, y, templateIndex, width, distant, src }, index) => {
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
                  src={src}
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
