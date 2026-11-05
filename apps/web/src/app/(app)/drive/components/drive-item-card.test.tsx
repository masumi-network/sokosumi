import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  DriveFilePreview,
  DriveItemCard,
  DriveItemName,
  driveItemActivation,
} from "@/app/drive/components/drive-item-card";
import {
  driveItemActionsClass,
  driveItemBodyClass,
} from "@/app/drive/components/drive-view-layout";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));
vi.mock("@/components/ui/image-viewer", () => ({
  ImageViewer: ({ activeSrc }: { activeSrc: string | null }) =>
    activeSrc ? <div data-testid="opened" data-viewer="image" /> : null,
}));
vi.mock("@/components/ui/document-viewer", () => ({
  DocumentViewer: ({ open, kind }: { open: boolean; kind: string }) =>
    open ? <div data-testid="opened" data-viewer={`document-${kind}`} /> : null,
}));

function openFile(name: string, sizeBytes: number | null = 2048) {
  const fileUrl = `https://store.public.blob.vercel-storage.com/drive/users/u/${name}`;
  render(
    <DriveFilePreview
      name={name}
      fileUrl={fileUrl}
      sizeBytes={sizeBytes}
      detailsHref="/drive/files/res-1"
    >
      {({ activate, nameEl, viewers }) => (
        <DriveItemCard viewMode="list" {...driveItemActivation(activate, name)}>
          {nameEl}
          {viewers}
        </DriveItemCard>
      )}
    </DriveFilePreview>,
  );
  fireEvent.click(screen.getByRole("button", { name }));
}

function openedViewer(): string {
  const dialog = screen.queryByTestId("drive-file-viewer");
  if (dialog) {
    if (dialog.querySelector("video")) return "video";
    if (dialog.querySelector("audio")) return "audio";
    return "download";
  }
  return screen.getByTestId("opened").dataset.viewer ?? "none";
}

describe("DriveFilePreview opens every file", () => {
  it.each([
    ["promo.mp4", "video"],
    ["clip.webm", "video"],
    ["screen.mov", "video"],
    ["podcast.mp3", "audio"],
    ["voice.wav", "audio"],
    ["call.m4a", "audio"],
    ["photo.png", "image"],
    ["report.pdf", "document-pdf"],
    ["notes.md", "document-text"],
    ["deck.pptx", "document-office"],
    ["assets.zip", "download"],
    ["backup.tar.gz", "download"],
    ["export.csv", "download"],
    ["installer.exe", "download"],
    ["README", "download"],
  ])("%s opens as %s", (name, expected) => {
    openFile(name);
    expect(openedViewer()).toBe(expected);
  });

  it("offers a download with the file's name and size for a type it cannot show", () => {
    openFile("assets.zip", 5 * 1024 * 1024);

    const dialog = screen.getByTestId("drive-file-viewer");
    expect(dialog).toHaveTextContent("assets.zip");
    expect(dialog).toHaveTextContent("5.0 MB");
    const download = screen.getByRole("link", {
      name: /viewerDownloadWithSize:5.0 MB/,
    });
    expect(download).toHaveAttribute("download", "assets.zip");
    expect(
      new URL(download.getAttribute("href") ?? "").searchParams.get("download"),
    ).toBe("1");
    expect(screen.getByRole("link", { name: "viewerDetails" })).toHaveAttribute(
      "href",
      "/drive/files/res-1",
    );
  });

  it("labels the player with the file name", () => {
    openFile("podcast.mp3");
    expect(
      screen.getByLabelText("podcast.mp3", { selector: "audio" }),
    ).toHaveAttribute("controls");
  });
});

describe("DriveItemCard name accessibility", () => {
  it("hides the visible name from AT when the card has an activate control", () => {
    render(
      <DriveItemCard
        viewMode="grid"
        {...driveItemActivation(() => undefined, "report.pdf")}
      >
        <DriveItemName name="report.pdf" />
      </DriveItemCard>,
    );

    expect(
      screen.getByRole("button", { name: "report.pdf" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "report.pdf" })).toHaveLength(
      1,
    );

    const visibleName = screen.getByText("report.pdf");
    expect(visibleName).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the visible name accessible when the card is not activatable", () => {
    render(
      <DriveItemCard viewMode="list">
        <DriveItemName name="report.pdf" />
      </DriveItemCard>,
    );

    const visibleName = screen.getByText("report.pdf");
    expect(visibleName).not.toHaveAttribute("aria-hidden", "true");
  });

  it("omits activation props when onActivate is undefined", () => {
    expect(driveItemActivation(undefined, "report.pdf")).toEqual({});
  });
});

describe("DriveItemCard actions positioning", () => {
  it("keeps grid overflow actions in document flow", () => {
    expect(driveItemActionsClass("grid")).toContain("shrink-0");
    expect(driveItemActionsClass("grid")).not.toContain("absolute");
    expect(driveItemBodyClass("grid")).toContain("items-center");
    expect(driveItemBodyClass("grid")).not.toContain("flex-col");

    render(
      <DriveItemCard
        viewMode="grid"
        actions={<button type="button">more</button>}
      >
        <span>file.docx</span>
      </DriveItemCard>,
    );

    const actions = screen.getByRole("button", { name: "more" }).parentElement;
    expect(actions).not.toBeNull();
    expect(actions?.className).toContain("shrink-0");
    expect(actions?.className).not.toContain("absolute");
  });

  it("keeps list actions in document flow", () => {
    render(
      <DriveItemCard
        viewMode="list"
        actions={<button type="button">more</button>}
      >
        <span>file.docx</span>
      </DriveItemCard>,
    );

    const actions = screen.getByRole("button", { name: "more" }).parentElement;
    expect(actions?.className).not.toContain("absolute");
  });
});
