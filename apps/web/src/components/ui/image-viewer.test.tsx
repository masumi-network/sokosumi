import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ImageViewer, type ImageViewerImage } from "./image-viewer";

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) => {
      if (key === "position") {
        return `${values?.current} / ${values?.total}`;
      }
      if (key === "stepAnnouncement") {
        return `Image ${values?.current} of ${values?.total}, ${values?.name}`;
      }
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
        previous: "Previous image",
        next: "Next image",
      };
      return labels[key] ?? key;
    },
}));

const PHOTO: ImageViewerImage = {
  src: "https://example.com/photo.png",
  alt: "Photo",
  downloadFilename: "photo.png",
};

const GALLERY: ImageViewerImage[] = [
  { src: "https://example.com/stage.jpg", alt: "stage.jpg" },
  { src: "https://example.com/panel.jpg", alt: "panel.jpg" },
  { src: "https://example.com/crowd.jpg", alt: "crowd.jpg" },
];

function GalleryHarness({ initialSrc }: { initialSrc: string }) {
  const [activeSrc, setActiveSrc] = useState<string | null>(initialSrc);
  return (
    <ImageViewer
      images={GALLERY}
      activeSrc={activeSrc}
      onActiveSrcChange={setActiveSrc}
    />
  );
}

function shownImageName(): string | null {
  return (
    screen
      .getByTestId("image-viewer-stage")
      .querySelector("img[data-zoom]")
      ?.getAttribute("alt") ?? null
  );
}

function swipe(fromX: number, toX: number): void {
  const stage = screen.getByTestId("image-viewer-stage");
  fireEvent.pointerDown(stage, {
    pointerId: 1,
    pointerType: "touch",
    clientX: fromX,
    clientY: 200,
  });
  fireEvent.pointerUp(stage, {
    pointerId: 1,
    pointerType: "touch",
    clientX: toX,
    clientY: 210,
  });
}

describe("ImageViewer", () => {
  it("renders toolbar, zoom controls, and download link", () => {
    render(
      <ImageViewer
        images={[PHOTO]}
        activeSrc={PHOTO.src}
        onActiveSrcChange={vi.fn()}
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
    const onActiveSrcChange = vi.fn();
    render(
      <ImageViewer
        images={[PHOTO]}
        activeSrc={PHOTO.src}
        onActiveSrcChange={onActiveSrcChange}
      />,
    );

    fireEvent.click(screen.getByRole("img", { name: "Photo" }));
    expect(onActiveSrcChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("image-viewer-stage"));
    expect(onActiveSrcChange).toHaveBeenCalledWith(null);
  });

  it("increases image scale when zooming in", async () => {
    const user = userEvent.setup();
    render(
      <ImageViewer
        images={[PHOTO]}
        activeSrc={PHOTO.src}
        onActiveSrcChange={vi.fn()}
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
        images={[PHOTO]}
        activeSrc={null}
        onActiveSrcChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
  });

  it("prints without injecting markup from alt text into the print document", async () => {
    const maliciousAlt = 'evil" onerror="alert(1)</title></style><script>alert(1)</script>';
    const printSpy = vi.fn();

    render(
      <ImageViewer
        images={[{ src: PHOTO.src, alt: maliciousAlt }]}
        activeSrc={PHOTO.src}
        onActiveSrcChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Print" }));

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();

    // happy-dom does not implement window.print(); provide it before the
    // iframe load event triggers printing.
    Object.defineProperty(iframe!.contentWindow, "print", {
      value: printSpy,
      writable: true,
    });

    const printDoc = iframe!.contentDocument;
    expect(printDoc).not.toBeNull();

    const image = printDoc!.querySelector("img");
    expect(image).not.toBeNull();

    expect(image!.getAttributeNames().sort()).toEqual(["alt", "src"]);
    expect(image!.getAttribute("alt")).toBe(maliciousAlt);
    expect(printDoc!.title).toBe(maliciousAlt);

    await waitFor(() => expect(printSpy).toHaveBeenCalled());
  });

  describe("gallery", () => {
    it("shows the active image of the list and its position", () => {
      render(
        <ImageViewer
          images={GALLERY}
          activeSrc="https://example.com/panel.jpg"
          onActiveSrcChange={vi.fn()}
        />,
      );

      const stage = screen.getByTestId("image-viewer-stage");
      expect(stage).toContainElement(
        screen.getByRole("img", { name: "panel.jpg" }),
      );
      expect(screen.getByTestId("image-viewer-toolbar")).toHaveTextContent(
        "2 / 3",
      );
    });

    it("shows no position or arrows for a single image", () => {
      render(
        <ImageViewer
          images={[PHOTO]}
          activeSrc={PHOTO.src}
          onActiveSrcChange={vi.fn()}
        />,
      );

      expect(screen.getByTestId("image-viewer-toolbar")).not.toHaveTextContent(
        "1 / 1",
      );
      expect(
        screen.queryByRole("button", { name: "Previous image" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Next image" }),
      ).not.toBeInTheDocument();
    });

    it("does not activate an ancestor click from inside the viewer", async () => {
      const user = userEvent.setup();
      const onAncestorClick = vi.fn();
      render(
        <div onClick={onAncestorClick}>
          <GalleryHarness initialSrc="https://example.com/panel.jpg" />
        </div>,
      );

      await user.click(screen.getByRole("button", { name: "Next image" }));
      expect(shownImageName()).toBe("crowd.jpg");
      expect(onAncestorClick).not.toHaveBeenCalled();

      await user.click(screen.getByTestId("image-viewer-stage"));
      expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
      expect(onAncestorClick).not.toHaveBeenCalled();
    });

    it("steps with the arrow buttons and stops at the ends", async () => {
      const user = userEvent.setup();
      render(<GalleryHarness initialSrc="https://example.com/stage.jpg" />);

      const previous = screen.getByRole("button", { name: "Previous image" });
      const next = screen.getByRole("button", { name: "Next image" });
      expect(previous).toHaveAttribute("aria-disabled", "true");

      await user.click(previous);
      expect(shownImageName()).toBe("stage.jpg");

      await user.click(next);
      expect(shownImageName()).toBe("panel.jpg");

      await user.click(next);
      expect(shownImageName()).toBe("crowd.jpg");
      expect(next).toHaveAttribute("aria-disabled", "true");
      expect(previous).not.toHaveAttribute("aria-disabled");

      await user.click(next);
      expect(shownImageName()).toBe("crowd.jpg");
      expect(screen.getByTestId("image-viewer-toolbar")).toHaveTextContent(
        "3 / 3",
      );

      await user.click(previous);
      expect(shownImageName()).toBe("panel.jpg");
    });

    it("announces the image it steps to", async () => {
      const user = userEvent.setup();
      render(<GalleryHarness initialSrc="https://example.com/stage.jpg" />);

      await user.click(screen.getByRole("button", { name: "Next image" }));

      expect(screen.getByRole("status")).toHaveTextContent(
        "Image 2 of 3, panel.jpg",
      );
    });

    it("steps with the arrow keys", async () => {
      const user = userEvent.setup();
      render(<GalleryHarness initialSrc="https://example.com/panel.jpg" />);

      await user.keyboard("{ArrowRight}");
      expect(shownImageName()).toBe("crowd.jpg");

      await user.keyboard("{ArrowRight}");
      expect(shownImageName()).toBe("crowd.jpg");

      await user.keyboard("{ArrowLeft}{ArrowLeft}");
      expect(shownImageName()).toBe("stage.jpg");
    });

    it("keeps the arrow keys working after clicking to the end", async () => {
      const user = userEvent.setup();
      render(<GalleryHarness initialSrc="https://example.com/panel.jpg" />);

      await user.click(screen.getByRole("button", { name: "Next image" }));
      expect(shownImageName()).toBe("crowd.jpg");

      await user.keyboard("{ArrowLeft}");
      expect(shownImageName()).toBe("panel.jpg");
    });

    it("steps with a swipe at 100% zoom", () => {
      render(<GalleryHarness initialSrc="https://example.com/panel.jpg" />);

      swipe(300, 150);
      expect(shownImageName()).toBe("crowd.jpg");

      swipe(150, 300);
      expect(shownImageName()).toBe("panel.jpg");

      swipe(300, 290);
      expect(shownImageName()).toBe("panel.jpg");
    });

    it("ignores a swipe while zoomed", async () => {
      const user = userEvent.setup();
      render(<GalleryHarness initialSrc="https://example.com/panel.jpg" />);

      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      swipe(300, 150);

      expect(shownImageName()).toBe("panel.jpg");
    });

    it("ignores a swipe while the page itself is pinch-zoomed", () => {
      const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: { scale: 2 },
      });
      try {
        render(<GalleryHarness initialSrc="https://example.com/panel.jpg" />);
        swipe(300, 150);
        expect(shownImageName()).toBe("panel.jpg");
      } finally {
        if (original) {
          Object.defineProperty(window, "visualViewport", original);
        } else {
          Reflect.deleteProperty(window, "visualViewport");
        }
      }
    });

    it("opens the next image at 100% zoom", async () => {
      const user = userEvent.setup();
      render(<GalleryHarness initialSrc="https://example.com/stage.jpg" />);

      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      await user.click(screen.getByRole("button", { name: "Next image" }));

      expect(screen.getByRole("img", { name: "panel.jpg" })).toHaveAttribute(
        "data-zoom",
        "1",
      );
    });

    it("closes when the open image leaves the list", () => {
      const { rerender } = render(
        <ImageViewer
          images={GALLERY}
          activeSrc="https://example.com/panel.jpg"
          onActiveSrcChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId("image-viewer")).toBeInTheDocument();

      rerender(
        <ImageViewer
          images={GALLERY.filter((image) => !image.src.endsWith("panel.jpg"))}
          activeSrc="https://example.com/panel.jpg"
          onActiveSrcChange={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
    });

    it("preloads only the previous and next image", () => {
      const images: ImageViewerImage[] = [
        ...GALLERY,
        { src: "https://example.com/podium.jpg", alt: "podium.jpg" },
      ];
      render(
        <ImageViewer
          images={images}
          activeSrc="https://example.com/panel.jpg"
          onActiveSrcChange={vi.fn()}
        />,
      );

      const preloaded = Array.from(
        screen
          .getByTestId("image-viewer")
          .querySelectorAll("img[data-preload]"),
        (image) => image.getAttribute("src"),
      );
      expect(preloaded).toEqual([
        "https://example.com/stage.jpg",
        "https://example.com/crowd.jpg",
      ]);
    });
  });
});
