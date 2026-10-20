import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdsSparkline } from "./ads-sparkline";

const polylines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("polyline")).map((line) =>
    line.getAttribute("points"),
  );

describe("AdsSparkline", () => {
  it("draws one line, oldest month left, highest month at the top", () => {
    const { container } = render(
      <AdsSparkline label="Trend" values={[0, 10, 5]} />,
    );

    // Width 80, height 24 with 2 of padding: min at y=22, max at y=2.
    expect(polylines(container)).toEqual(["0.0,22.0 40.0,2.0 80.0,12.0"]);
  });

  it("describes itself for people who cannot see it", () => {
    render(<AdsSparkline label="From 1,200 to 1,800" values={[1, 2]} />);

    expect(
      screen.getByRole("img", { name: "From 1,200 to 1,800" }),
    ).toBeVisible();
  });

  it("leaves a gap for a month without data", () => {
    const { container } = render(
      <AdsSparkline label="Trend" values={[1, 4, null, 1, 4]} />,
    );

    expect(polylines(container)).toHaveLength(2);
    expect(polylines(container)[0]).toBe("0.0,22.0 20.0,2.0");
    expect(polylines(container)[1]).toBe("60.0,22.0 80.0,2.0");
  });

  it("shows a lone month as a dot", () => {
    const { container } = render(
      <AdsSparkline label="Trend" values={[null, 5, null, 7, 8]} />,
    );

    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(polylines(container)).toHaveLength(1);
  });

  it("draws a flat series through the middle", () => {
    const { container } = render(
      <AdsSparkline label="Trend" values={[3, 3, 3]} />,
    );

    expect(polylines(container)).toEqual(["0.0,12.0 40.0,12.0 80.0,12.0"]);
  });

  it("renders nothing when no month has data", () => {
    const { container } = render(
      <AdsSparkline label="Trend" values={[null, null]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
