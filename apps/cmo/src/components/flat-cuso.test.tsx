// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FlatCuso } from "./flat-cuso";

function render(element: React.ReactElement): Document {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(element),
    "text/html",
  );
}

describe("FlatCuso", () => {
  it("is a labelled image by default", () => {
    const svg = render(<FlatCuso size={96} />).querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Cuso");
  });

  it("is hidden from assistive tech with an empty label", () => {
    const svg = render(<FlatCuso size={96} label="" />).querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.hasAttribute("role")).toBe(false);
  });

  it("draws a different arm for each pose", () => {
    const arms = (["point", "wave", "stand"] as const).map(
      (pose) =>
        render(<FlatCuso size={96} pose={pose} />)
          .querySelector("[data-part=arm-right]")
          ?.getAttribute("d") ?? "",
    );
    expect(new Set(arms).size).toBe(3);
  });

  it("marks the variant for styling", () => {
    const doc = render(<FlatCuso size={96} variant="solid" />);
    expect(doc.querySelector("svg")?.dataset.variant).toBe("solid");
  });

  it("crops to the head inside a circle", () => {
    const doc = render(<FlatCuso size={40} crop />);
    expect(doc.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "89 135 280 280",
    );
    expect(doc.querySelector("clipPath circle")).not.toBeNull();
  });

  it("thickens the line at small crop sizes, never thinner", () => {
    const width = (size: number) =>
      Number(
        render(<FlatCuso size={size} crop />)
          .querySelector("[data-part=body]")
          ?.getAttribute("stroke-width"),
      );
    expect(width(96)).toBe(22);
    expect(width(20)).toBeGreaterThan(width(40));
  });
});
