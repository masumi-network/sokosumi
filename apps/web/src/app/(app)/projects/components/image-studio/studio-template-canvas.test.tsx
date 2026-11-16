import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_EMPTY_ADS } from "./studio-empty-ads";
import { TEST_LABELS } from "./studio-fixtures";
import { StudioTemplateCanvas } from "./studio-template-canvas";
import { STUDIO_TEMPLATES } from "./studio-templates";
import {
  buildStudioWall,
  getStudioWallTransform,
  getVisibleStudioWallRects,
} from "./studio-wall-layout";

vi.mock("next/image", () => ({
  default: function MockImage({ alt, src }: { alt: string; src: string }) {
    return <img alt={alt} src={src} />;
  },
}));

const publicRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../public",
);

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
];
const OFFSETS = [
  { x: 0, y: 0 },
  { x: -37, y: 913 },
  { x: 12345, y: -6789 },
  { x: -99999, y: 42 },
];
const AD_TEMPLATES = [
  ["daybreak-oats", 4],
  ["lumen-sip", 0],
  ["sable-ink", 3],
  ["ridge-and-river", 4],
  ["ledgerly", 2],
  ["northbench-coffee", 1],
  ["fieldstep-sneakers", 1],
  ["solara-routes", 2],
  ["nimbus-air", 0],
  ["cedar-volt", 1],
  ["aero-loom", 3],
  ["bramble-rye", 0],
  ["kite-and-kiln", 2],
  ["cinder-cycle", 4],
  ["parcelly", 3],
  ["paloma-skin", 0],
  ["fern-and-co", 1],
  ["hollow-pine", 0],
  ["tidewell", 0],
  ["noctis", 0],
  ["polar-plum", 0],
  ["barkley-bowl", 1],
  ["oliveta", 1],
  ["pulsewise", 1],
  ["stillform", 1],
  ["cacao-hour", 3],
  ["fizzwell", 3],
  ["paper-lantern", 3],
  ["keyforge", 2],
  ["margin-notes", 2],
  ["casa-lumbre", 4],
  ["saltline", 4],
] as const;

let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  frames.clear();
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const preference = matchMedia(query);
    Object.defineProperty(preference, "matches", {
      configurable: true,
      value: query === "(prefers-reduced-motion: no-preference)",
    });
    return preference;
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function advanceFrame(timestamp: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of callbacks) callback(timestamp);
  });
}

function mount() {
  const onApplyTemplate = vi.fn();
  const { container } = render(
    <StudioTemplateCanvas
      labels={TEST_LABELS}
      onApplyTemplate={onApplyTemplate}
    />,
  );
  const canvas = container.querySelector<HTMLElement>("[data-studio-canvas]")!;
  const tile = canvas.querySelector<HTMLElement>("[data-studio-tile]")!;
  const row = canvas.querySelector<HTMLElement>("[data-studio-row]")!;
  const column = canvas.querySelector<HTMLElement>("[data-studio-column]")!;
  return { canvas, tile, row, column, onApplyTemplate };
}

function position(row: HTMLElement, column: HTMLElement) {
  const coordinates = (element: HTMLElement) =>
    element.style.transform
      .slice("translate3d(".length)
      .split(",")
      .map(Number.parseFloat);
  return { x: coordinates(row)[0], y: coordinates(column)[1] };
}

describe("Studio ad wall layout", () => {
  it("ships 32 unique WebP ads with the matching template and existing files", () => {
    expect(STUDIO_EMPTY_ADS).toHaveLength(32);
    expect(new Set(STUDIO_EMPTY_ADS.map((ad) => ad.src)).size).toBe(32);
    expect(STUDIO_EMPTY_ADS).toEqual(
      expect.arrayContaining(
        AD_TEMPLATES.map(([name, templateIndex]) => ({
          src: `/studio/empty-ads/${name}.webp`,
          templateIndex,
        })),
      ),
    );
    for (const { src } of STUDIO_EMPTY_ADS) {
      expect(src).toMatch(/^\/studio\/empty-ads\/[^/]+\.webp$/);
      expect(existsSync(join(publicRoot, src.slice(1))), src).toBe(true);
    }
  });

  it.each(VIEWPORTS)(
    "places every ad once with uniform gutters at $width × $height",
    (viewport) => {
      const layout = buildStudioWall(viewport);
      expect(buildStudioWall(viewport)).toEqual(layout);
      expect(layout.columnWidth).toBe(
        Math.min(248, Math.max(148, Math.round(viewport.width / 6.2))),
      );
      expect(layout.gap).toBe(12);
      expect(layout.columns).toHaveLength(
        Math.min(
          8,
          Math.max(
            3,
            Math.ceil(
              (viewport.width + layout.columnWidth) /
                (layout.columnWidth + layout.gap),
            ),
          ),
        ),
      );
      expect(layout.periodX).toBe(
        layout.columns.length * (layout.columnWidth + layout.gap),
      );
      if (viewport.width <= 1440) {
        expect(layout.periodX).toBeGreaterThanOrEqual(viewport.width);
      }
      const periods = layout.columns.map((column) => column.period);
      const tallestCard = Math.max(
        ...layout.columns.flatMap((column) =>
          column.cards.map((card) => card.height),
        ),
      );
      expect(Math.max(...periods) - Math.min(...periods)).toBeLessThanOrEqual(
        tallestCard + layout.gap,
      );
      const adIndices = layout.columns.flatMap((column) =>
        column.cards.map((card) => card.adIndex),
      );
      expect(adIndices.toSorted((a, b) => a - b)).toEqual(
        STUDIO_EMPTY_ADS.map((_, index) => index),
      );
      expect(new Set(layout.columns.map((column) => column.phase)).size).toBe(
        layout.columns.length,
      );
      for (const [columnIndex, column] of layout.columns.entries()) {
        expect(column.cards.length).toBeGreaterThan(1);
        expect(column.cards[0].y).toBe(0);
        for (const [cardIndex, card] of column.cards.entries()) {
          const next = column.cards[(cardIndex + 1) % column.cards.length];
          const template =
            STUDIO_TEMPLATES[STUDIO_EMPTY_ADS[card.adIndex].templateIndex];
          const [width, height] = template.aspectRatio.split(":").map(Number);
          expect(card.height).toBeCloseTo(
            layout.columnWidth / (width / height),
          );
          expect(next.adIndex).not.toBe(card.adIndex);
          expect(
            STUDIO_TEMPLATES[STUDIO_EMPTY_ADS[next.adIndex].templateIndex]
              .aspectRatio,
          ).not.toBe(template.aspectRatio);
          expect(
            next.y +
              (cardIndex === column.cards.length - 1 ? column.period : 0) -
              card.y -
              card.height,
          ).toBeCloseTo(layout.gap);
        }
        const neighbour =
          layout.columns[(columnIndex + 1) % layout.columns.length];
        const neighbourAds = new Set(
          neighbour.cards.map((card) => card.adIndex),
        );
        for (const card of column.cards) {
          expect(neighbourAds.has(card.adIndex)).toBe(false);
        }
      }
    },
  );

  it.each(VIEWPORTS)(
    "covers $width × $height at huge positive and negative offsets",
    (viewport) => {
      const layout = buildStudioWall(viewport);
      for (const offset of OFFSETS) {
        const rects = getVisibleStudioWallRects(layout, offset);
        let largestDistance = 0;
        for (
          let x = 0;
          x <= viewport.width;
          x = Math.min(x + 19, viewport.width)
        ) {
          for (
            let y = 0;
            y <= viewport.height;
            y = Math.min(y + 19, viewport.height)
          ) {
            const distance = Math.min(
              ...rects.map((rect) =>
                Math.hypot(
                  Math.max(rect.x - x, 0, x - rect.x - rect.width),
                  Math.max(rect.y - y, 0, y - rect.y - rect.height),
                ),
              ),
            );
            largestDistance = Math.max(largestDistance, distance);
            if (y === viewport.height) break;
          }
          if (x === viewport.width) break;
        }
        expect(
          largestDistance,
          `offset ${offset.x}, ${offset.y}`,
        ).toBeLessThanOrEqual(layout.gap + 0.000001);
      }
    },
  );
});

describe("Studio template canvas", () => {
  it("renders all 32 ads as decorative cached copies", () => {
    const { canvas } = mount();
    const images = canvas.querySelectorAll("[data-studio-tile] img");
    const sources = Array.from(images, (image) => image.getAttribute("src"));
    expect(new Set(sources).size).toBe(32);
    expect(canvas).toHaveAttribute("aria-hidden", "true");
  });

  it.each(AD_TEMPLATES)(
    "applies the matching brief when tapping %s",
    (name, templateIndex) => {
      const { canvas, onApplyTemplate } = mount();
      const image = canvas.querySelector(
        `img[src="/studio/empty-ads/${name}.webp"]`,
      );
      expect(image).not.toBeNull();
      fireEvent.pointerDown(image!, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
      expect(onApplyTemplate).toHaveBeenCalledExactlyOnceWith(
        STUDIO_TEMPLATES[templateIndex],
      );
    },
  );

  it("moves along both axes while dragging and applies a brief only on a tap", () => {
    const { canvas, tile, row, column, onApplyTemplate } = mount();
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 38, clientY: 57 });
    expect(canvas).toHaveAttribute("data-dragging");
    const transform = getStudioWallTransform(
      buildStudioWall({ width: 0, height: 0 }),
      { x: 28, y: 47 },
    );
    expect(position(row, column).x).toBeCloseTo(transform.x);
    expect(position(row, column).y).toBeCloseTo(transform.columnY[0]);
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 38, clientY: 57 });
    expect(canvas).not.toHaveAttribute("data-dragging");
    expect(onApplyTemplate).not.toHaveBeenCalled();

    fireEvent.pointerDown(tile, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 11, clientY: 12 });
    const ad = STUDIO_EMPTY_ADS[Number(tile.dataset.studioTile)];
    expect(onApplyTemplate).toHaveBeenCalledExactlyOnceWith(
      STUDIO_TEMPLATES[ad.templateIndex],
    );
  });

  it("pans with the wheel and preserves browser zoom gestures", () => {
    const { canvas, row, column } = mount();
    fireEvent.wheel(canvas, { deltaX: 37, deltaY: -913 });
    const transform = getStudioWallTransform(
      buildStudioWall({ width: 0, height: 0 }),
      { x: -37, y: 913 },
    );
    expect(position(row, column).x).toBeCloseTo(transform.x);
    expect(position(row, column).y).toBeCloseTo(transform.columnY[0]);
    const before = position(row, column);
    for (const key of ["ctrlKey", "metaKey"]) {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        deltaX: 80,
        deltaY: 90,
      });
      Object.defineProperty(event, key, { value: true });
      fireEvent(canvas, event);
    }
    expect(position(row, column)).toEqual(before);
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)(
    "releases a touch after %s without applying a brief",
    (event) => {
      const { canvas, tile, onApplyTemplate } = mount();
      fireEvent.pointerDown(tile, { pointerId: 1, pointerType: "touch" });
      fireEvent[event](canvas, { pointerId: 1, pointerType: "touch" });
      fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "touch" });
      expect(canvas).not.toHaveAttribute("data-interacting");
      expect(onApplyTemplate).not.toHaveBeenCalled();
    },
  );

  it("drifts the wall and pauses while toggled or dragging", () => {
    const { canvas, tile, row, column } = mount();
    advanceFrame(0);
    const initial = position(row, column);
    advanceFrame(1000);
    expect(position(row, column)).not.toEqual(initial);

    fireEvent.click(
      screen.getByRole("button", { name: "pauseTemplateMotion" }),
    );
    expect(canvas).toHaveAttribute("data-paused", "true");
    const paused = position(row, column);
    advanceFrame(2000);
    advanceFrame(3000);
    expect(position(row, column)).toEqual(paused);

    fireEvent.click(
      screen.getByRole("button", { name: "resumeTemplateMotion" }),
    );
    expect(canvas).toHaveAttribute("data-paused", "false");
    advanceFrame(4000);
    advanceFrame(5000);
    expect(position(row, column)).not.toEqual(paused);

    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
    const dragging = position(row, column);
    advanceFrame(6000);
    advanceFrame(7000);
    expect(position(row, column)).toEqual(dragging);
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    advanceFrame(8000);
    advanceFrame(9000);
    expect(position(row, column)).not.toEqual(dragging);
  });

  it("keeps the wall still when reduced motion is preferred", () => {
    const preference = window.matchMedia(
      "(prefers-reduced-motion: no-preference)",
    );
    Object.defineProperty(preference, "matches", { value: false });
    vi.spyOn(window, "matchMedia").mockReturnValue(preference);
    const { row, column } = mount();
    const initial = position(row, column);
    advanceFrame(0);
    advanceFrame(1000);
    expect(position(row, column)).toEqual(initial);
    expect(
      screen.getByRole("button", { name: "pauseTemplateMotion" }),
    ).toHaveClass("motion-reduce:hidden");
  });

  it("rebuilds the wall when the canvas is resized", () => {
    let resize = () => undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => undefined) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { canvas, row } = mount();
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 1440 },
      clientHeight: { configurable: true, value: 900 },
    });
    act(() => resize());
    const layout = buildStudioWall({ width: 1440, height: 900 });
    expect(position(row, canvas.querySelector("[data-studio-column]")!).x).toBe(
      -layout.periodX,
    );
    expect(
      canvas.querySelector<HTMLElement>("[data-studio-column]")!.style.width,
    ).toBe(`${layout.columnWidth}px`);
  });
});
