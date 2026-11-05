"use client";
import { TABLE_COLUMN_WIDTH } from "@sokosumi/utils";
import { useRef } from "react";
import { clampColumnWidth, RESIZE_STEP } from "./grid-layout";

/**
 * A column's trailing edge. Drag it, or focus it and press the left and
 * right arrow keys; a double click fits the column to its content.
 */
export function ColumnResizeHandle({
  label,
  width,
  onPreview,
  onResize,
  onFit,
}: {
  label: string;
  width: number;
  onPreview: (width: number) => void;
  onResize: (width: number) => void;
  onFit: () => void;
}) {
  const drag = useRef<{ x: number; width: number; direction: number } | null>(
    null,
  );
  function widthAt(clientX: number) {
    const start = drag.current;
    return start
      ? clampColumnWidth(start.width + (clientX - start.x) * start.direction)
      : width;
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={TABLE_COLUMN_WIDTH.min}
      aria-valuemax={TABLE_COLUMN_WIDTH.max}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          width,
          direction:
            getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1,
        };
      }}
      onPointerMove={(event) => {
        if (drag.current) onPreview(widthAt(event.clientX));
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        const next = widthAt(event.clientX);
        drag.current = null;
        if (start && next !== start.width) onResize(next);
      }}
      onPointerCancel={() => {
        if (drag.current) onPreview(drag.current.width);
        drag.current = null;
      }}
      onDoubleClick={onFit}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = clampColumnWidth(width + step * RESIZE_STEP);
        if (next !== width) onResize(next);
      }}
      className="after:bg-ring focus-visible:after:opacity-100 absolute inset-y-0 end-0 z-10 w-3 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:end-0 after:w-0.5 after:opacity-0 after:transition-opacity hover:after:opacity-100"
    />
  );
}
