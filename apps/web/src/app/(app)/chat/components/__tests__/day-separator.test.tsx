import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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
    // Testing Library flushes effects — post-mount label is visible.
    expect(screen.getByText("2026-07-01T12:00:00.000Z")).toBeInTheDocument();
  });

  it("SSR markup has no local-calendar label (hydration-stable shell)", () => {
    const markup = renderToStaticMarkup(
      <DaySeparator
        date={new Date("2026-08-05T22:30:00.000Z")}
        formatDaySeparator={() => "Today"}
      />,
    );
    expect(markup).not.toContain("Today");
  });
});
