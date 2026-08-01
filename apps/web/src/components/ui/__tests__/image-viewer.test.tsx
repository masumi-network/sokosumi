import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageViewer } from "../image-viewer";

describe("ImageViewer", () => {
  it("renders toolbar actions outside the image stage", () => {
    render(
      <ImageViewer
        open
        onOpenChange={vi.fn()}
        src="https://example.com/photo.png"
        alt="Photo"
        title="View image"
        downloadLabel="Download image"
        closeLabel="Close"
        downloadFilename="photo.png"
      />,
    );

    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();

    const toolbar = screen.getByTestId("image-viewer-toolbar");
    const stage = screen.getByTestId("image-viewer-stage");

    expect(toolbar).toContainElement(
      screen.getByRole("link", { name: "Download image" }),
    );
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Close" }),
    );
    expect(stage).toContainElement(screen.getByRole("img", { name: "Photo" }));
    expect(stage.querySelector("a")).toBeNull();
    expect(stage.querySelector("button")).toBeNull();

    const download = screen.getByRole("link", { name: "Download image" });
    expect(download).toHaveAttribute("href", "https://example.com/photo.png");
    expect(download).toHaveAttribute("download", "photo.png");
  });

  it("does not render dialog content when closed", () => {
    render(
      <ImageViewer
        open={false}
        onOpenChange={vi.fn()}
        src="https://example.com/photo.png"
        alt="Photo"
        title="View image"
        downloadLabel="Download image"
        closeLabel="Close"
      />,
    );

    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
  });
});
