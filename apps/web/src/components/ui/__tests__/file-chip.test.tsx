import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
          download: "Download document",
          close: "Close",
          openInNewTab: "Open in new tab",
          fetchError: "This document couldn't be loaded.",
        };
        return documentLabels[key] ?? key;
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

describe("FileChip", () => {
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
      screen.getByRole("link", { name: "Download document" }),
    ).toHaveAttribute("href", "https://blob.example.com/uploads/brief.docx");
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
});
