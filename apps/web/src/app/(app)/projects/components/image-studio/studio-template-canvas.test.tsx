import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TEST_LABELS } from "./studio-fixtures";
import { StudioTemplateCanvas } from "./studio-template-canvas";

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
  return { canvas, tile, onApplyTemplate };
}

describe("floating Studio templates", () => {
  it("moves along both axes while dragging and applies a brief only on a tap", () => {
    const { canvas, tile, onApplyTemplate } = mount();
    const position = () =>
      tile.style.transform.match(/-?[\d.]+(?=px)/g)?.map(Number) ?? [];
    const [x, y] = position();
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 38, clientY: 57 });
    expect(canvas).toHaveAttribute("data-dragging");
    const [nextX, nextY] = position();
    expect(nextX).toBeCloseTo((x ?? 0) + 28);
    expect(nextY).toBeCloseTo((y ?? 0) + 47);
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 38, clientY: 57 });
    expect(canvas).not.toHaveAttribute("data-dragging");
    expect(onApplyTemplate).not.toHaveBeenCalled();

    fireEvent.pointerDown(tile, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 11, clientY: 12 });
    expect(onApplyTemplate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "banner" }),
    );
  });

  it("releases a cancelled touch and exposes a motion toggle", () => {
    const { canvas, tile, onApplyTemplate } = mount();
    fireEvent.pointerDown(tile, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerCancel(canvas, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "touch" });
    expect(canvas).not.toHaveAttribute("data-interacting");
    expect(onApplyTemplate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "pauseTemplateMotion" }),
    );
    expect(canvas).toHaveAttribute("data-paused", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "resumeTemplateMotion" }),
    );
    expect(canvas).toHaveAttribute("data-paused", "false");
  });
});
