import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Select } from "@/components/ui/select";
import { STATUS_ROLE_STYLES } from "@/components/ui/status-marker";
import { TaskStatus } from "@/lib/clients/generated/core";

import { TaskStatusPillSelectTrigger } from "./task-status-pill-select-trigger";

/**
 * COMPLETED, not RUNNING. The running marker is lucide's `LoaderCircle`, which
 * is the same component the pending spinner uses, and it already spins, so on
 * that one status the two branches render byte-identical markup and every
 * assertion below would hold with the swap deleted.
 */
const STATUS = TaskStatus.COMPLETED;
const ROLE = STATUS_ROLE_STYLES.success;

function renderTrigger(isPending: boolean) {
  return render(
    <Select value={STATUS}>
      <TaskStatusPillSelectTrigger
        status={STATUS}
        label="Complete"
        ariaLabel="Change status"
        isPending={isPending}
      />
    </Select>,
  );
}

/** The glyph is the only element inside the pill that carries a role colour. */
function glyphOf(container: HTMLElement): SVGElement {
  const glyph = container
    .querySelector("span.inline-flex")
    ?.querySelector("svg");
  if (!glyph) throw new Error("the pill rendered no glyph");
  return glyph;
}

describe("TaskStatusPillSelectTrigger", () => {
  it("marks the resting pill with the role glyph, and does not spin it", () => {
    const glyph = glyphOf(renderTrigger(false).container);

    expect(glyph).toHaveClass(ROLE.marker);
    expect(glyph).not.toHaveClass("animate-spin");
  });

  /**
   * The spinner replaces the glyph rather than joining it, so it has to occupy
   * the same box, carry the same colour and hold the same stroke. A lighter
   * 2px stroke erodes on the dark fills, which is why StatusMarker sets 2.25.
   */
  it("hands the pending spinner the glyph's box, colour and stroke", () => {
    const spinner = glyphOf(renderTrigger(true).container);

    expect(spinner).toHaveClass(
      "size-3.5",
      "shrink-0",
      "animate-spin",
      ROLE.marker,
    );
    expect(spinner).toHaveAttribute("stroke-width", "2.25");
  });

  /** The spin is decoration; it stops when the reader asks for less motion. */
  it("stops the spinner under prefers-reduced-motion", () => {
    const spinner = glyphOf(renderTrigger(true).container);

    expect(spinner).toHaveClass("motion-reduce:animate-none");
  });
});
