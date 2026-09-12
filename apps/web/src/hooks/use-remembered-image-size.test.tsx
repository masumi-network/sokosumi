import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useRememberedImageSize } from "./use-remembered-image-size";

function Picture({ src }: { src: string }) {
  const size = useRememberedImageSize(src);
  return <img alt="" src={src} {...size} />;
}

function stubNaturalSize(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: height });
}

describe("useRememberedImageSize", () => {
  it("reserves the box on remount once the image has loaded before", () => {
    const first = render(<Picture src="https://img.example/a.png" />);
    const img = screen.getByRole<HTMLImageElement>("presentation");
    expect(img).not.toHaveAttribute("width");

    stubNaturalSize(img, 1200, 630);
    fireEvent.load(img);
    first.unmount();

    render(<Picture src="https://img.example/a.png" />);
    const again = screen.getByRole<HTMLImageElement>("presentation");
    expect(again).toHaveAttribute("width", "1200");
    expect(again).toHaveAttribute("height", "630");
  });

  it("knows nothing about a URL that never loaded", () => {
    render(<Picture src="https://img.example/never.png" />);
    const img = screen.getByRole<HTMLImageElement>("presentation");
    expect(img).not.toHaveAttribute("width");
    expect(img).not.toHaveAttribute("height");
  });

  it("ignores a load that reports no size", () => {
    const first = render(<Picture src="https://img.example/broken.png" />);
    const img = screen.getByRole<HTMLImageElement>("presentation");
    stubNaturalSize(img, 0, 0);
    fireEvent.load(img);
    first.unmount();

    render(<Picture src="https://img.example/broken.png" />);
    expect(screen.getByRole("presentation")).not.toHaveAttribute("width");
  });
});
