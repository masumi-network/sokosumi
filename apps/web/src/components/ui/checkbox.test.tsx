import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("draws a dash, not a tick, when only some are selected", () => {
    render(<Checkbox aria-label="Select all" checked="indeterminate" />);

    const box = screen.getByRole("checkbox", { name: "Select all" });
    expect(box).toHaveAttribute("aria-checked", "mixed");
    expect(box.querySelector(".lucide-minus")).toBeInTheDocument();
    expect(box.querySelector(".lucide-check")).not.toBeInTheDocument();
  });

  it("draws a tick when checked", () => {
    render(<Checkbox aria-label="Pick" checked />);

    const box = screen.getByRole("checkbox", { name: "Pick" });
    expect(box.querySelector(".lucide-check")).toBeInTheDocument();
    expect(box.querySelector(".lucide-minus")).not.toBeInTheDocument();
  });
});
