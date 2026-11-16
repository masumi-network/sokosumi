"use client";

import { select } from "d3-selection";
import {
  type ZoomBehavior,
  type ZoomTransform,
  zoom,
  zoomIdentity,
  zoomTransform,
} from "d3-zoom";
import { type RefCallback, useCallback, useRef, useState } from "react";

/** The map zooms in to an eighth of its area: a cluster of easy keywords pulls apart there. */
export const SEO_MAP_MAX_ZOOM = 8;

/**
 * Pan and zoom of the keyword map, with the d3-zoom of the contacts map: drag, double-click, a pinch on a
 * trackpad (the browser sends it as a wheel with the control key) and two fingers on a touch screen. A plain
 * wheel and one finger scroll the page: the map sits in a long page and must not catch the scroll.
 */
export function useSeoMapZoom() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const control = useRef<{
    behavior: ZoomBehavior<HTMLDivElement, unknown>;
    element: HTMLDivElement;
  } | null>(null);
  const frame: RefCallback<HTMLDivElement> = useCallback((element) => {
    if (!element) return;
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([1, SEO_MAP_MAX_ZOOM])
      .filter((event: WheelEvent | MouseEvent | TouchEvent) => {
        if (event.type === "wheel") return event.ctrlKey || event.metaKey;
        if (event.type === "touchstart")
          return (event as TouchEvent).touches.length > 1;
        return !event.ctrlKey && !(event as MouseEvent).button;
      })
      .on("zoom", (event: { transform: ZoomTransform }) =>
        setTransform(event.transform),
      );
    control.current = { behavior, element };
    // d3-zoom blocks every touch gesture; one finger gives the scroll of the page back.
    const selection = select(element)
      .call(behavior)
      .style("touch-action", "pan-y");
    let last = { width: 0, height: 0 };
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || (width === last.width && height === last.height)) return;
      behavior
        .extent([
          [0, 0],
          [width, height],
        ])
        .translateExtent([
          [0, 0],
          [width, height],
        ]);
      // The same view when the frame resizes.
      const ratio = last.width ? width / last.width : 1;
      const { k, x, y } = zoomTransform(element);
      last = { width, height };
      setSize(last);
      behavior.transform(
        selection,
        zoomIdentity.translate(x * ratio, y * ratio).scale(k),
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      selection.on(".zoom", null);
      control.current = null;
    };
  }, []);
  /** Zoom in or out around a point of the frame (its middle by default); null shows the whole map again. */
  const zoomBy = useCallback((factor: number | null, at?: [number, number]) => {
    if (!control.current) return;
    const { behavior, element } = control.current;
    if (factor === null) behavior.transform(select(element), zoomIdentity);
    else behavior.scaleBy(select(element), factor, at);
  }, []);
  return { frame, size, transform, zoomBy };
}
