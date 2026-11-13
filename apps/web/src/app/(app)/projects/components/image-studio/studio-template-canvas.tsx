"use client";

import { Pause, Play } from "lucide-react";
import Image from "next/image";
import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { STUDIO_EMPTY_ADS } from "./studio-empty-ads";
import { STUDIO_TEMPLATES, type StudioTemplate } from "./studio-templates";
import { buildStudioWall, getStudioWallTransform } from "./studio-wall-layout";
import type { StudioLabels } from "./types";

const DRAG_THRESHOLD = 6;

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
  const rowRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<(HTMLDivElement | null)[]>([]);
  const offset = useRef({ x: 0, y: 0 });
  const [wall, setWall] = useState(() =>
    buildStudioWall({ width: 0, height: 0 }),
  );
  const wallRef = useRef(wall);
  const drag = useRef<Drag | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  function paint() {
    const current = wallRef.current;
    const { x, columnY } = getStudioWallTransform(current, offset.current);
    if (rowRef.current)
      rowRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
    columnsRef.current.forEach((column, index) => {
      if (column)
        column.style.transform = `translate3d(0, ${columnY[index % current.columns.length]}px, 0)`;
    });
  }

  useLayoutEffect(() => {
    wallRef.current = wall;
    paint();
  }, [wall]);

  function pan(x: number, y: number) {
    offset.current.x += x;
    offset.current.y += y;
    paint();
  }

  useMountEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      setWall((current) =>
        current.width === width && current.height === height
          ? current
          : buildStudioWall({ width, height }),
      );
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
            ? wallRef.current.height
            : 1;
      pan(-event.deltaX * factor, -event.deltaY * factor);
    }

    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    let frame = 0;
    let lastTime: number | null = null;

    function drift(time: number) {
      if (lastTime !== null && !pausedRef.current && !drag.current) {
        const seconds = Math.min(time - lastTime, 64) / 1000;
        pan(seconds * 12, seconds * 4);
      }
      lastTime = time;
      frame = requestAnimationFrame(drift);
    }

    function updateMotion() {
      cancelAnimationFrame(frame);
      lastTime = null;
      if (motion.matches) frame = requestAnimationFrame(drift);
    }

    updateMotion();
    motion.addEventListener("change", updateMotion);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", updateMotion);
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
    const tile = STUDIO_EMPTY_ADS[current.tile];
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
        {/* On phones, crop into the same arrangement to leave space between cards. */}
        <div
          className="absolute top-0 left-0 flex"
          data-studio-row=""
          dir="ltr"
          ref={rowRef}
          style={{ width: wall.horizontalCopies * wall.periodX }}
        >
          {Array.from({ length: wall.horizontalCopies }, (_, copy) =>
            wall.columns.map((column, columnIndex) => (
              <div
                className="relative shrink-0"
                data-studio-column={columnIndex}
                key={`${copy}:${columnIndex}`}
                ref={(node) => {
                  columnsRef.current[copy * wall.columns.length + columnIndex] =
                    node;
                }}
                style={{
                  width: wall.columnWidth,
                  marginRight: wall.gap,
                }}
              >
                {Array.from({ length: column.verticalCopies }, (_, repeat) =>
                  column.cards.map(({ adIndex, y, height }) => {
                    const { src, templateIndex } = STUDIO_EMPTY_ADS[adIndex];
                    const template = STUDIO_TEMPLATES[templateIndex];
                    return (
                      <div
                        className="border-border bg-background absolute left-0 w-full overflow-hidden rounded-xl border opacity-80 hover:opacity-100"
                        data-studio-tile={adIndex}
                        key={`${repeat}:${adIndex}`}
                        style={{
                          top: repeat * column.period + y,
                          height,
                          aspectRatio: template.aspectRatio.replace(":", " / "),
                        }}
                      >
                        <Image
                          alt=""
                          className="pointer-events-none object-cover"
                          draggable={false}
                          fill
                          sizes={`${wall.columnWidth}px`}
                          src={src}
                        />
                      </div>
                    );
                  }),
                )}
              </div>
            )),
          )}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--card-background)_15%,transparent_71%)]" />
      </div>
      <Button
        aria-label={
          paused ? labels.resumeTemplateMotion : labels.pauseTemplateMotion
        }
        className="absolute end-3 bottom-3 z-10 motion-reduce:hidden md:end-5 md:bottom-5"
        onClick={() => {
          pausedRef.current = !pausedRef.current;
          setPaused(pausedRef.current);
        }}
        size="icon"
        type="button"
        variant="outline"
      >
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
      </Button>
    </>
  );
}
