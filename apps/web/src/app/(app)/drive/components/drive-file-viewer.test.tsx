import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DriveFileViewer } from "@/app/drive/components/drive-file-viewer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));
vi.mock("@/components/ui/image-viewer", () => ({
  ImageViewer: ({ activeSrc }: { activeSrc: string | null }) => (
    <div data-testid="image-viewer" data-src={activeSrc} />
  ),
}));
vi.mock("@/components/ui/document-viewer", () => ({
  DocumentViewer: ({ kind }: { kind: string }) => (
    <div data-testid="document-viewer" data-kind={kind} />
  ),
}));

const store = { scope: "me" } as const;
const noop = () => undefined;

function open(displayName: string, mimeType: string | null) {
  return render(
    <DriveFileViewer
      file={{ id: "res-1", displayName, mimeType }}
      store={store}
      onClose={noop}
    />,
  );
}

describe("DriveFileViewer", () => {
  it("opens an image in the task image viewer, through the authorized route", () => {
    open("logo.png", "image/png");
    expect(screen.getByTestId("image-viewer").dataset.src).toBe(
      "/api/drive/files/res-1/content?scope=me",
    );
  });

  it("opens a PDF and a text file in the document viewer", () => {
    const { unmount } = open("report.pdf", "application/pdf");
    expect(screen.getByTestId("document-viewer").dataset.kind).toBe("pdf");
    unmount();

    // No recorded type: the name decides, as it does on the detail page.
    open("notes.md", null);
    expect(screen.getByTestId("document-viewer").dataset.kind).toBe("text");
  });

  it("falls back to a download for a type it cannot show", () => {
    open("assets.zip", "application/zip");
    expect(screen.getByTestId("drive-file-viewer")).toBeVisible();
    expect(screen.getByText("viewerNoPreview")).toBeVisible();
  });

  it("plays video and audio through the authorized route", () => {
    const { unmount } = open("promo.mp4", "video/mp4");
    expect(
      screen.getByLabelText("promo.mp4", { selector: "video" }),
    ).toHaveAttribute("src", "/api/drive/files/res-1/content?scope=me");
    unmount();

    open("podcast.mp3", null);
    expect(
      screen.getByLabelText("podcast.mp3", { selector: "audio" }),
    ).toHaveAttribute("controls");
  });

  it("names the size on the download for a file it cannot show", () => {
    render(
      <DriveFileViewer
        file={{
          id: "res-1",
          displayName: "assets.zip",
          mimeType: "application/zip",
          sizeBytes: 2048,
        }}
        store={store}
        onClose={noop}
      />,
    );
    expect(
      screen.getByRole("link", { name: /viewerDownloadWithSize:2.0 KB/ }),
    ).toHaveAttribute(
      "href",
      "/api/drive/files/res-1/content?scope=me&download=true",
    );
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <DriveFileViewer file={null} store={store} onClose={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
