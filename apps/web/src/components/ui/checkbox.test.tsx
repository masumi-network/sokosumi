import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";

// Which icon shows follows Radix's own data-state, so a controlled and an
// uncontrolled box agree. happy-dom has no Tailwind, so assert the state the
// CSS keys on and the class each icon carries for it.
function icons(box: HTMLElement) {
  return {
    dash: box.querySelector(".lucide-minus"),
    tick: box.querySelector(".lucide-check"),
  };
}

describe("Checkbox", () => {
  it.each([
    ["controlled", { checked: "indeterminate" as const }],
    ["uncontrolled", { defaultChecked: "indeterminate" as const }],
  ])("shows the dash, not the tick, when %s and only some are selected", (_, props) => {
    render(<Checkbox aria-label="Select all" {...props} />);

    const box = screen.getByRole("checkbox", { name: "Select all" });
    expect(box).toHaveAttribute("aria-checked", "mixed");
    expect(box).toHaveAttribute("data-state", "indeterminate");
    const { dash, tick } = icons(box);
    expect(dash).toHaveClass("group-data-[state=indeterminate]:block");
    expect(tick).toHaveClass("group-data-[state=indeterminate]:hidden");
    expect(box).toHaveClass("group");
  });

  it("switches an uncontrolled mixed box to the tick when clicked", async () => {
    render(<Checkbox aria-label="Select all" defaultChecked="indeterminate" />);
    const box = screen.getByRole("checkbox", { name: "Select all" });

    await userEvent.click(box);

    expect(box).toHaveAttribute("data-state", "checked");
    expect(icons(box).tick).not.toHaveClass("hidden");
  });
});
