import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DaySeparator from "../day-separator";

describe("DaySeparator", () => {
  it("uses tight vertical padding on the outer wrapper", () => {
    const { container } = render(
      <DaySeparator
        date={new Date("2026-07-01T12:00:00.000Z")}
        formatDaySeparator={(date) => date.toISOString()}
      />,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveClass("pt-2");
    expect(wrapper).toHaveClass("pb-1");
    expect(wrapper).not.toHaveClass("py-4");
    expect(screen.getByText("2026-07-01T12:00:00.000Z")).toBeInTheDocument();
  });
});
