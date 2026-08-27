import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ImageViewer } from "./image-viewer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      title: "Image",
      download: "Download image",
      close: "Close",
      print: "Print",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      zoomReset: "Reset zoom",
      more: "More options",
      openInNewTab: "Open in new tab",
      copyImage: "Copy image",
    };
    return labels[key] ?? key;
  },
}));

describe("ImageViewer", () => {
  it("renders toolbar, zoom controls, and download link", () => {
    render(
      <ImageViewer
        open
        onOpenChange={vi.fn()}
        src="https://example.com/photo.png"
        alt="Photo"
        downloadFilename="photo.png"
      />,
    );

    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();

    const toolbar = screen.getByTestId("image-viewer-toolbar");
    const stage = screen.getByTestId("image-viewer-stage");
    const zoom = screen.getByTestId("image-viewer-zoom");

    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Close" }),
    );
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Print" }),
    );
    expect(toolbar).toContainElement(
      screen.getByRole("link", { name: "Download image" }),
    );
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "More options" }),
    );

    expect(zoom).toContainElement(
      screen.getByRole("button", { name: "Zoom out" }),
    );
    expect(zoom).toContainElement(
      screen.getByRole("button", { name: "Reset zoom" }),
    );
    expect(zoom).toContainElement(
      screen.getByRole("button", { name: "Zoom in" }),
    );

    expect(stage).toContainElement(screen.getByRole("img", { name: "Photo" }));

    const download = screen.getByRole("link", { name: "Download image" });
    expect(download).toHaveAttribute("href", "https://example.com/photo.png");
    expect(download).toHaveAttribute("download", "photo.png");
  });

  it("closes when the stage is clicked but not when the image is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <ImageViewer
        open
        onOpenChange={onOpenChange}
        src="https://example.com/photo.png"
        alt="Photo"
      />,
    );

    fireEvent.click(screen.getByRole("img", { name: "Photo" }));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("image-viewer-stage"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("increases image scale when zooming in", async () => {
    const user = userEvent.setup();
    render(
      <ImageViewer
        open
        onOpenChange={vi.fn()}
        src="https://example.com/photo.png"
        alt="Photo"
      />,
    );

    const image = screen.getByRole("img", { name: "Photo" });
    expect(image).toHaveAttribute("data-zoom", "1");
    expect(image).toHaveStyle({ transform: "scale(1)" });

    await user.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(image).toHaveAttribute("data-zoom", "1.25");
    expect(image).toHaveStyle({ transform: "scale(1.25)" });
  });

  it("does not render dialog content when closed", () => {
    render(
      <ImageViewer
        open={false}
        onOpenChange={vi.fn()}
        src="https://example.com/photo.png"
        alt="Photo"
      />,
    );

    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
  });
});
