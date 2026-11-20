"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

import {
  getStudioWallTransform,
  type StudioWallLayout,
} from "@/app/projects/components/image-studio/studio-wall-layout";

export function applyStudioWallTransform(
  row: HTMLElement | null,
  columns: readonly (HTMLElement | null)[],
  wall: StudioWallLayout,
  offset: { x: number; y: number },
): void {
  const { x, columnY } = getStudioWallTransform(wall, offset);
  if (row) {
    row.style.transform = `translate3d(${x}px, 0, 0)`;
  }
  columns.forEach((column, index) => {
    if (column) {
      column.style.transform = `translate3d(0, ${columnY[index % wall.columns.length]}px, 0)`;
    }
  });
}

/**
 * Syncs `wallRef` and applies the Studio template wall's row and column
 * transforms before paint whenever the measured wall layout changes.
 */
export function useStudioWallPaint(
  rowRef: RefObject<HTMLDivElement | null>,
  columnsRef: RefObject<(HTMLDivElement | null)[]>,
  offsetRef: RefObject<{ x: number; y: number }>,
  wall: StudioWallLayout,
): RefObject<StudioWallLayout> {
  const wallRef = useRef(wall);

  useLayoutEffect(() => {
    wallRef.current = wall;
    applyStudioWallTransform(
      rowRef.current,
      columnsRef.current,
      wall,
      offsetRef.current,
    );
  }, [wall, rowRef, columnsRef, offsetRef]);

  return wallRef;
}
