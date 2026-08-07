import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  FileChipMiniPreview,
  FileChipMiniPreviewFrame,
} from "../file-chip-mini-preview";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
  }: {
    alt: string;
    src: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, unknown>) => {
      if (namespace === "Components.DocumentViewer") {
        const documentLabels: Record<string, string> = {
          title: "Document",
          viewDocument: `View document ${values?.fileName ?? ""}`,
          download: "Download",
          openInNewTab: "Open in new tab",
          loading: "Loading document…",
          fetchError: "This document couldn't be loaded.",
        };
        return documentLabels[key] ?? key;
      }
      if (key === "viewImage") {
        return `View image ${values?.fileName ?? ""}`;
      }
      if (key === "title") {
        return "Image";
      }
      if (key === "download") {
        return "Download image";
      }
      if (key === "close") {
        return "Close";
      }
      return key;
    },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("FileChipMiniPreviewFrame", () => {
  it("does not render filename or size description text", () => {
    render(
      <FileChipMiniPreviewFrame
        url="https://blob.example.com/uploads/notes.pdf"
        fileName="notes.pdf"
        mediaType="application/pdf"
        size={2048}
      />,
    );

    expect(screen.queryByText("notes.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText(/2(\.0)?\s*KB/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("tooltip-content")).not.toBeInTheDocument();
  });

  it("opens an image viewer instead of navigating away for image files", () => {
    render(
      <FileChipMiniPreviewFrame
        url="https://blob.example.com/uploads/photo.png"
        fileName="photo.png"
        mediaType="image/png"
      />,
    );

    expect(
      screen.queryByRole("link", { name: /photo\.png/i }),
    ).not.toBeInTheDocument();

    const imageButton = screen.getByRole("button", {
      name: "View image photo.png",
    });
    expect(imageButton).toHaveClass("cursor-pointer");
    fireEvent.click(imageButton);

    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download image" }),
    ).toHaveAttribute("href", "https://blob.example.com/uploads/photo.png");
  });

  it("renders large image variant with object-contain and still opens viewer", () => {
    render(
      <FileChipMiniPreviewFrame
        url="https://blob.example.com/uploads/photo.png"
        fileName="photo.png"
        mediaType="image/png"
        variant="large"
      />,
    );

    const imageButton = screen.getByRole("button", {
      name: "View image photo.png",
    });
    expect(imageButton).toHaveClass("max-w-full");
    expect(imageButton).toHaveClass("max-h-80");
    expect(imageButton).not.toHaveClass("size-20");
    expect(imageButton).not.toHaveClass("size-16");

    const previewImage = screen.getByRole("img", { name: "photo.png" });
    expect(previewImage).toHaveClass("object-contain");
    expect(previewImage).toHaveClass("max-w-full");
    expect(previewImage).toHaveClass("max-h-80");

    fireEvent.click(imageButton);
    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();
  });

  it("falls back to thumb layout when large variant is used for non-images", () => {
    render(
      <FileChipMiniPreviewFrame
        url="https://blob.example.com/uploads/notes.pdf"
        fileName="notes.pdf"
        mediaType="application/pdf"
        variant="large"
        sizeClass="size-16"
      />,
    );

    const documentButton = screen.getByRole("button", {
      name: "View document notes.pdf",
    });
    expect(documentButton).toHaveClass("size-16");
    expect(documentButton).not.toHaveClass("max-w-sm");
  });

  it("opens a document viewer instead of navigating away for previewable documents", () => {
    render(
      <FileChipMiniPreviewFrame
        url="https://blob.example.com/uploads/notes.pdf"
        fileName="notes.pdf"
        mediaType="application/pdf"
      />,
    );

    expect(
      screen.queryByRole("link", { name: /notes\.pdf/i }),
    ).not.toBeInTheDocument();

    const documentButton = screen.getByRole("button", {
      name: "View document notes.pdf",
    });
    expect(documentButton).toHaveClass("cursor-pointer");
    fireEvent.click(documentButton);

    expect(screen.getByTestId("document-viewer")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download" }),
    ).toHaveAttribute("href", "https://blob.example.com/uploads/notes.pdf");
  });

  it("keeps a download/open link for unsupported file types", () => {
    render(
      <FileChipMiniPreviewFrame
        url="https://blob.example.com/uploads/archive.zip"
        fileName="archive.zip"
        mediaType="application/zip"
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveClass("cursor-pointer");
    expect(link).toHaveAttribute(
      "href",
      "https://blob.example.com/uploads/archive.zip",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("document-viewer")).not.toBeInTheDocument();
  });

  it("renders an inline video player for video attachments on the sent-message frame", () => {
    const { container } = render(
      <FileChipMiniPreviewFrame
        url="https://blob.example.com/uploads/clip.mp4?download=1"
        fileName="clip.mp4"
      />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute(
      "src",
      "https://blob.example.com/uploads/clip.mp4",
    );
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveClass("absolute", "inset-0", "size-full", "object-contain");
    expect(screen.getByTestId("file-chip-video")).toHaveClass(
      "min-w-0",
      "w-full",
      "max-w-sm",
      "overflow-hidden",
      "shrink",
    );
    expect(screen.getByTestId("file-chip-video")).not.toHaveClass("basis-full");
    expect(screen.getByTestId("file-chip-video-frame")).toHaveClass(
      "relative",
      "min-w-0",
      "w-full",
      "overflow-hidden",
    );
  });

  it("renders an inline audio player for audio attachments on the sent-message frame", () => {
    const { container } = render(
      <FileChipMiniPreviewFrame
        url="https://blob.example.com/uploads/track.mp3"
        fileName="track.mp3"
        mediaType="audio/mpeg"
      />,
    );

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute(
      "src",
      "https://blob.example.com/uploads/track.mp3",
    );
    expect(screen.getByTestId("file-chip-audio")).toBeInTheDocument();
  });
});

describe("FileChipMiniPreview", () => {
  it("keeps composer video drafts compact without an inline player", () => {
    const { container } = render(
      <FileChipMiniPreview
        url="https://blob.example.com/uploads/clip.mp4"
        fileName="clip.mp4"
      />,
    );

    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByTestId("file-chip-video")).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://blob.example.com/uploads/clip.mp4",
    );
  });

  it("shows filename and size in tooltip content", () => {
    render(
      <FileChipMiniPreview
        url="https://blob.example.com/uploads/notes.pdf"
        fileName="notes.pdf"
        mediaType="application/pdf"
        size={2048}
      />,
    );

    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip).toHaveTextContent("notes.pdf");
    expect(tooltip).toHaveTextContent(/2(\.0)?\s*KB/i);
  });

  it("shows filename in tooltip content when size is omitted", () => {
    render(
      <FileChipMiniPreview
        url="https://blob.example.com/uploads/notes.pdf"
        fileName="notes.pdf"
        mediaType="application/pdf"
      />,
    );

    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "notes.pdf",
    );
  });

  it("opens an image viewer instead of navigating away for image files", () => {
    render(
      <FileChipMiniPreview
        url="https://blob.example.com/uploads/photo.png"
        fileName="photo.png"
        mediaType="image/png"
      />,
    );

    expect(
      screen.queryByRole("link", { name: /photo\.png/i }),
    ).not.toBeInTheDocument();

    const imageButton = screen.getByRole("button", {
      name: "View image photo.png",
    });
    expect(imageButton).toHaveClass("cursor-pointer");
    fireEvent.click(imageButton);

    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download image" }),
    ).toHaveAttribute("href", "https://blob.example.com/uploads/photo.png");
  });

  it("opens a document viewer instead of navigating away for previewable documents", () => {
    render(
      <FileChipMiniPreview
        url="https://blob.example.com/uploads/notes.pdf"
        fileName="notes.pdf"
        mediaType="application/pdf"
      />,
    );

    expect(
      screen.queryByRole("link", { name: /notes\.pdf/i }),
    ).not.toBeInTheDocument();

    const documentButton = screen.getByRole("button", {
      name: "View document notes.pdf",
    });
    expect(documentButton).toHaveClass("cursor-pointer");
    fireEvent.click(documentButton);

    expect(screen.getByTestId("document-viewer")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download" }),
    ).toHaveAttribute("href", "https://blob.example.com/uploads/notes.pdf");
  });

  it("keeps a download/open link for unsupported file types", () => {
    render(
      <FileChipMiniPreview
        url="https://blob.example.com/uploads/archive.zip"
        fileName="archive.zip"
        mediaType="application/zip"
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveClass("cursor-pointer");
    expect(link).toHaveAttribute(
      "href",
      "https://blob.example.com/uploads/archive.zip",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("document-viewer")).not.toBeInTheDocument();
  });
});
