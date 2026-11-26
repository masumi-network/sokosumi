"use client";

import { Pause, Play } from "lucide-react";
import Image from "next/image";
import { type PointerEvent, useRef, useState } from "react";

import {
  usePageListSearch,
  usePageSearchQuery,
} from "@/components/page-list-search";
import { Button } from "@/components/ui/button";
import { useAnimationFrame } from "@/hooks/effects/use-animation-frame";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import { usePrefersReducedMotion } from "@/hooks/effects/use-media-query";
import { useResizeObserver } from "@/hooks/effects/use-resize-observer";
import {
  applyStudioWallTransform,
  useStudioWallPaint,
} from "@/hooks/effects/use-studio-wall-paint";
import { STUDIO_EMPTY_ADS } from "./studio-empty-ads";
import { TemplateButton } from "./studio-template-picker";
import { STUDIO_TEMPLATES, type StudioTemplate } from "./studio-templates";
import { buildStudioWall } from "./studio-wall-layout";
import type { StudioLabels } from "./types";

const DRAG_THRESHOLD = 6;

interface Drag {
  id: number;
  x: number;
  y: number;
  tile: number;
  moved: boolean;
}

interface TemplateCanvasProps {
  labels: StudioLabels;
  onApplyTemplate: (template: StudioTemplate) => void;
}

export function StudioTemplateCanvas(props: TemplateCanvasProps) {
  const query = usePageSearchQuery();
  const templates = usePageListSearch(STUDIO_TEMPLATES, (template) => ({
    primary: [props.labels.templateLabels[template.id]],
    secondary: [template.prompt, template.aspectRatio],
  }));
  if (query)
    return (
      <div
        className="flex flex-wrap content-start gap-2"
        aria-label={props.labels.templates}
      >
        {templates.map((template) => (
          <TemplateButton
            key={template.id}
            template={template}
            label={props.labels.templateLabels[template.id]}
            onApplyTemplate={props.onApplyTemplate}
          />
        ))}
      </div>
    );
  return <TemplateCanvas {...props} />;
}

function TemplateCanvas({ labels, onApplyTemplate }: TemplateCanvasProps) {
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<(HTMLDivElement | null)[]>([]);
  const offset = useRef({ x: 0, y: 0 });
  const [wall, setWall] = useState(() =>
    buildStudioWall({ width: 0, height: 0 }),
  );
  const wallRef = useStudioWallPaint(rowRef, columnsRef, offset, wall);
  const drag = useRef<Drag | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const reduceMotion = usePrefersReducedMotion();

  function pan(x: number, y: number) {
    offset.current.x += x;
    offset.current.y += y;
    applyStudioWallTransform(
      rowRef.current,
      columnsRef.current,
      wallRef.current,
      offset.current,
    );
  }

  useAnimationFrame(!reduceMotion, (deltaSeconds) => {
    if (!pausedRef.current && !drag.current) {
      const seconds = Math.min(deltaSeconds, 0.064);
      pan(seconds * 12, seconds * 4);
    }
  });

  useResizeObserver(
    canvas,
    () => {
      if (!canvas) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      setWall((current) =>
        current.width === width && current.height === height
          ? current
          : buildStudioWall({ width, height }),
      );
    },
    { immediate: true },
  );

  useEventListener(
    canvas,
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey || drag.current) return;
      event.preventDefault();
      const factor =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? wallRef.current.height
            : 1;
      pan(-event.deltaX * factor, -event.deltaY * factor);
    },
    { passive: false },
  );

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
        ref={setCanvas}
      >
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
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--card-background)_15%,transparent_71%)] max-sm:bg-[radial-gradient(ellipse_at_center,var(--card-background)_40%,transparent_90%)]" />
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
