import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentViewer } from "./document-viewer";

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
      close: "Close",
      download: "Download",
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

  it("shows the filename and a single action row with open, download, and close", () => {
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

    const close = screen.getByRole("button", { name: "Close" });
    const download = screen.getByRole("link", { name: "Download" });
    expect(download).toHaveAttribute(
      "href",
      "https://blob.example.com/report.pdf",
    );
    expect(download).toHaveAttribute("download", "report.pdf");
    expect(download).toHaveAttribute("title", "Download");

    const openInNewTab = screen.getByRole("link", { name: "Open in new tab" });
    expect(openInNewTab).toHaveAttribute(
      "href",
      "https://blob.example.com/report.pdf",
    );
    expect(openInNewTab).toHaveAttribute("target", "_blank");
    expect(openInNewTab).toHaveAttribute("title", "Open in new tab");

    // All three controls share one flex action row (not an absolute close).
    const actionRow = close.parentElement;
    expect(actionRow).toContainElement(download);
    expect(actionRow).toContainElement(openInNewTab);
  });

  describe("PDF embed", () => {
    const originalFetch = global.fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    function createPdfResponse(
      body: BlobPart = new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      contentType = "application/octet-stream",
    ): Response {
      return new Response(new Blob([body], { type: contentType }), {
        status: 200,
        headers: { "Content-Type": contentType },
      });
    }

    beforeEach(() => {
      global.fetch = vi.fn();
      URL.createObjectURL = vi.fn(() => "blob:https://viewer/pdf-1");
      URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      vi.restoreAllMocks();
    });

    it("fetches the PDF and embeds a same-origin blob URL so attachment disposition cannot force a download", async () => {
      vi.mocked(global.fetch).mockResolvedValue(createPdfResponse());

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

      expect(screen.getByLabelText("Loading document…")).toBeInTheDocument();

      const iframe = await screen.findByTitle("report.pdf");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://blob.example.com/report.pdf",
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(URL.createObjectURL).toHaveBeenCalledWith(
        expect.objectContaining({ type: "application/pdf" }),
      );
      expect(iframe).toHaveAttribute(
        "src",
        "blob:https://viewer/pdf-1#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
      );
      // Download / open-in-new-tab still point at the original public URL.
      expect(
        screen.getByRole("link", { name: "Download" }),
      ).toHaveAttribute("href", "https://blob.example.com/report.pdf");
    });

    it("strips ?download=1 before fetching so Vercel Blob attachment URLs still preview", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        createPdfResponse(new Uint8Array([0x25])),
      );

      render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/report.pdf?download=1"
          fileName="report.pdf"
          kind="pdf"
        />,
      );

      await screen.findByTitle("report.pdf");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://blob.example.com/report.pdf",
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    it("falls back to a direct iframe when fetch fails (e.g. CORS)", async () => {
      vi.mocked(global.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

      render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/report.pdf?download=1"
          fileName="report.pdf"
          kind="pdf"
        />,
      );

      const iframe = await screen.findByTitle("report.pdf");
      expect(iframe).toHaveAttribute(
        "src",
        "https://blob.example.com/report.pdf#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
      );
    });

    it("revokes the object URL when the viewer unmounts", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        createPdfResponse(new Uint8Array([0x25])),
      );

      const { unmount } = render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/report.pdf"
          fileName="report.pdf"
          kind="pdf"
        />,
      );

      await screen.findByTitle("report.pdf");
      unmount();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:https://viewer/pdf-1",
      );
    });

    it("revokes the object URL when unmounted while the PDF fetch is still pending", async () => {
      let resolveFetch!: (response: Response) => void;
      const pendingFetch = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
      vi.mocked(global.fetch).mockReturnValue(pendingFetch);

      const { unmount } = render(
        <DocumentViewer
          open
          onOpenChange={vi.fn()}
          url="https://blob.example.com/report.pdf"
          fileName="report.pdf"
          kind="pdf"
        />,
      );

      expect(screen.getByLabelText("Loading document…")).toBeInTheDocument();
      unmount();

      resolveFetch(createPdfResponse(new Uint8Array([0x25])));
      // Flush post-unmount settlement of the deferred fetch.
      await pendingFetch;
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByTitle("report.pdf")).not.toBeInTheDocument();
      // Late createObjectURL (mock ignores abort) must still be revoked.
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:https://viewer/pdf-1",
      );
    });
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

    it("still embeds the PDF viewer when the URL has no extension", async () => {
      const originalFetch = global.fetch;
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      try {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          blob: () => Promise.resolve(new Blob([new Uint8Array([0x25])])),
        } as Response);
        URL.createObjectURL = vi.fn(() => "blob:https://viewer/pdf-extless");
        URL.revokeObjectURL = vi.fn();

        render(
          <DocumentViewer
            open
            onOpenChange={vi.fn()}
            url="https://blob.example.com/report"
            fileName="report.pdf"
            kind="pdf"
          />,
        );

        expect(await screen.findByTitle("report.pdf")).toHaveAttribute(
          "src",
          "blob:https://viewer/pdf-extless#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
        );
      } finally {
        global.fetch = originalFetch;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      }
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
