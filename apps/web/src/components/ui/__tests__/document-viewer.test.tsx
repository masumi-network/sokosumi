import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentViewer } from "../document-viewer";

vi.mock("@/components/markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-mock">{children}</div>
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      title: "Document",
      download: "Download document",
      openInNewTab: "Open in new tab",
      loading: "Loading document…",
      fetchError: "This document couldn't be loaded.",
    };
    return labels[key] ?? key;
  },
}));

describe("DocumentViewer", () => {
  it("does not render dialog content when closed", () => {
    render(
      <DocumentViewer
        open={false}
        onOpenChange={vi.fn()}
        url="https://blob.example.com/report.pdf"
        fileName="report.pdf"
        kind="pdf"
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the standard themed dialog shell, not a full-screen lightbox", () => {
    render(
      <DocumentViewer
        open
        onOpenChange={vi.fn()}
        url="https://blob.example.com/report.pdf"
        fileName="report.pdf"
        kind="pdf"
        mediaType="application/pdf"
      />,
    );

    const panel = screen.getByRole("dialog");
    expect(panel).not.toHaveClass("bg-black");
    expect(panel).not.toHaveClass("h-screen");
  });

  it("shows the filename, download, and open-in-new-tab controls, and keeps the default close button", () => {
    render(
      <DocumentViewer
        open
        onOpenChange={vi.fn()}
        url="https://blob.example.com/report.pdf"
        fileName="report.pdf"
        kind="pdf"
        mediaType="application/pdf"
      />,
    );

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();

    const download = screen.getByRole("link", { name: "Download document" });
    expect(download).toHaveAttribute(
      "href",
      "https://blob.example.com/report.pdf",
    );
    expect(download).toHaveAttribute("download", "report.pdf");

    const openInNewTab = screen.getByRole("link", { name: "Open in new tab" });
    expect(openInNewTab).toHaveAttribute(
      "href",
      "https://blob.example.com/report.pdf",
    );
    expect(openInNewTab).toHaveAttribute("target", "_blank");
  });

  it("embeds a PDF natively with the toolbar hidden", () => {
    render(
      <DocumentViewer
        open
        onOpenChange={vi.fn()}
        url="https://blob.example.com/report.pdf"
        fileName="report.pdf"
        kind="pdf"
        mediaType="application/pdf"
      />,
    );

    const iframe = screen.getByTitle("report.pdf");
    expect(iframe).toHaveAttribute(
      "src",
      "https://blob.example.com/report.pdf#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
    );
  });

  it("routes an Office file through the Microsoft Office Online viewer", () => {
    render(
      <DocumentViewer
        open
        onOpenChange={vi.fn()}
        url="https://blob.example.com/brief.docx"
        fileName="brief.docx"
        kind="office"
      />,
    );

    const iframe = screen.getByTitle("brief.docx");
    expect(iframe).toHaveAttribute(
      "src",
      "https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fblob.example.com%2Fbrief.docx",
    );
  });

  describe("extensionless URL, kind decided by the caller from the filename", () => {
    // Regression coverage: the chip components fall back to `fileName` when
    // `url` itself has no recognizable extension (classifyFilePreview), and
    // pass the resulting `kind` down explicitly — DocumentViewer must render
    // from that prop rather than re-deriving `kind` from `url` alone, or it
    // renders an empty body for a dialog that already committed to opening.

    it("still embeds the PDF viewer when the URL has no extension", () => {
      render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/report"
          fileName="report.pdf"
          kind="pdf"
        />,
      );

      expect(screen.getByTitle("report.pdf")).toHaveAttribute(
        "src",
        "https://blob.example.com/report#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
      );
    });

    it("still routes to the Office viewer when the URL has no extension", () => {
      render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/report"
          fileName="report.docx"
          kind="office"
        />,
      );

      expect(screen.getByTitle("report.docx")).toHaveAttribute(
        "src",
        "https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fblob.example.com%2Freport%3Ffilename%3Dfile.docx",
      );
    });

    it("still fetches and renders text content when the URL has no extension", async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("Plain notes"),
      } as Response);

      render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/report"
          fileName="notes.txt"
          kind="text"
        />,
      );

      expect(await screen.findByText(/Plain notes/)).toBeInTheDocument();
      global.fetch = originalFetch;
    });
  });

  describe("text/markdown files", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("fetches and renders the content", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("# Notes\n\nHello world"),
      } as Response);

      render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/notes.md"
          fileName="notes.md"
          kind="text"
        />,
      );

      expect(await screen.findByText(/Hello world/)).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledWith(
        "https://blob.example.com/notes.md",
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    it("shows a fallback message when the fetch fails", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
      } as Response);

      render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/notes.md"
          fileName="notes.md"
          kind="text"
        />,
      );

      await waitFor(() =>
        expect(
          screen.getByText("This document couldn't be loaded."),
        ).toBeInTheDocument(),
      );
    });
  });
});
