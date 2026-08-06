import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileChip } from "../file-chip";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
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
          download: "Download",
          openInNewTab: "Open in new tab",
          loading: "Loading document…",
          fetchError: "This document couldn't be loaded.",
        };
        return documentLabels[key] ?? key;
      }
      if (key === "download") {
        return "Download image";
      }
      return key;
    },
}));

describe("FileChip", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens an image viewer instead of navigating away for image files", () => {
    render(
      <FileChip
        url="https://blob.example.com/uploads/photo.png"
        fileName="photo.png"
      />,
    );

    expect(
      screen.queryByRole("link", { name: /photo\.png/i }),
    ).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: /photo\.png/i });
    fireEvent.click(trigger);

    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download image" }),
    ).toHaveAttribute("href", "https://blob.example.com/uploads/photo.png");
  });

  it("opens a document viewer instead of navigating away for previewable documents", () => {
    render(
      <FileChip
        url="https://blob.example.com/uploads/brief.docx"
        fileName="brief.docx"
      />,
    );

    expect(
      screen.queryByRole("link", { name: /brief\.docx/i }),
    ).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: /brief\.docx/i });
    fireEvent.click(trigger);

    expect(screen.getByTestId("document-viewer")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download" }),
    ).toHaveAttribute("href", "https://blob.example.com/uploads/brief.docx");
  });

  it("actually previews an extensionless URL recognized only via the filename fallback", async () => {
    // Regression: FileChip decides to open the viewer via classifyFilePreview's
    // fileName fallback (the URL alone has no extension) — the opened
    // DocumentViewer must render real preview content from that same
    // decision, not a blank body.
    // Force the CORS/network fallback so the iframe src is the public URL
    // (not a blob: object URL).
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    render(
      <FileChip
        url="https://blob.example.com/uploads/report"
        fileName="report.pdf"
      />,
    );

    const trigger = screen.getByRole("button", { name: /report\.pdf/i });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByTitle("report.pdf")).toHaveAttribute(
        "src",
        "https://blob.example.com/uploads/report#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
      );
    });
  });

  it("opens a document viewer for an extensionless URL when mediaType is a previewable MIME", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    render(
      <FileChip
        url="https://blob.example.com/uploads/abcdef012345"
        mediaType="application/pdf"
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    expect(screen.getByTestId("document-viewer")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle("abcdef012345")).toHaveAttribute(
        "src",
        "https://blob.example.com/uploads/abcdef012345#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
      );
    });
  });

  it("opens an image viewer for an extensionless URL when mediaType is image/*", () => {
    render(
      <FileChip
        url="https://blob.example.com/uploads/abcdef012345"
        mediaType="image/png"
      />,
    );

    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);

    expect(screen.getByTestId("image-viewer")).toBeInTheDocument();
  });

  it("renders an inline video player for video files instead of a download link", () => {
    const { container } = render(
      <FileChip
        url="https://blob.example.com/uploads/clip.mp4?download=1"
        fileName="clip.mp4"
      />,
    );

    expect(screen.queryByRole("link", { name: /clip\.mp4/i })).not.toBeInTheDocument();

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute(
      "src",
      "https://blob.example.com/uploads/clip.mp4",
    );
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveClass("max-h-80");
    expect(video).toHaveClass("min-w-0");
    expect(video).toHaveClass("w-full");
    expect(video).toHaveClass("max-w-full");
    expect(video).toHaveClass("object-contain");
    expect(video).toHaveClass("rounded-lg");
    expect(screen.getByTestId("file-chip-video")).toHaveClass(
      "min-w-0",
      "w-full",
      "max-w-full",
      "overflow-hidden",
    );
    // download secondary still available (exact name avoids nested media fallback)
    expect(screen.getByRole("link", { name: /^download$/i })).toHaveAttribute(
      "href",
      "https://blob.example.com/uploads/clip.mp4?download=1",
    );
  });

  it("renders an inline audio player for audio files", () => {
    const { container } = render(
      <FileChip
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
    expect(audio).toHaveAttribute("controls");
    expect(audio).not.toHaveAttribute("autoplay");
  });

  it("keeps a plain download/open link for unsupported file types", () => {
    render(
      <FileChip
        url="https://blob.example.com/uploads/archive.zip"
        fileName="archive.zip"
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "https://blob.example.com/uploads/archive.zip",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("document-viewer")).not.toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("shows the filename and formatted size", () => {
    render(
      <FileChip
        url="https://blob.example.com/uploads/archive.zip"
        fileName="archive.zip"
        size={2048}
      />,
    );

    expect(screen.getByText("archive.zip")).toBeInTheDocument();
    expect(screen.getByText(/2(\.0)?\s*KB/i)).toBeInTheDocument();
  });

  it("preserves a title tooltip when the chip renders as an image-preview button", () => {
    render(
      <FileChip
        url="https://blob.example.com/uploads/photo.png"
        fileName="photo.png"
        title="image/png"
      />,
    );

    expect(screen.getByRole("button", { name: /photo\.png/i })).toHaveAttribute(
      "title",
      "image/png",
    );
  });

  it("preserves a title tooltip when the chip renders as a document-preview button", () => {
    render(
      <FileChip
        url="https://blob.example.com/uploads/brief.docx"
        fileName="brief.docx"
        title="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      />,
    );

    expect(screen.getByRole("button", { name: /brief\.docx/i })).toHaveAttribute(
      "title",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("preserves a title tooltip for the plain-link fallback", () => {
    render(
      <FileChip
        url="https://blob.example.com/uploads/archive.zip"
        fileName="archive.zip"
        title="application/zip"
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "title",
      "application/zip",
    );
  });

  it("preserves a title tooltip on the inline media player container", () => {
    const { container } = render(
      <FileChip
        url="https://blob.example.com/uploads/clip.mp4"
        fileName="clip.mp4"
        title="video/mp4"
      />,
    );

    expect(container.querySelector('[data-testid="file-chip-video"]')).toHaveAttribute(
      "title",
      "video/mp4",
    );
  });
});
