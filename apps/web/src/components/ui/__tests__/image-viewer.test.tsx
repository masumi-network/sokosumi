import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageViewer } from "../image-viewer";

describe("ImageViewer", () => {
  it("renders the image and download action when open", () => {
    render(
      <ImageViewer
        open
        onOpenChange={vi.fn()}
        src="https://example.com/photo.png"
        alt="Photo"
        title="View image"
        downloadLabel="Download image"
        downloadFilename="photo.png"
      />,
    );

    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Photo" })).toHaveAttribute(
      "src",
      "https://example.com/photo.png",
    );

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
      />,
    );

    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
  });
});
