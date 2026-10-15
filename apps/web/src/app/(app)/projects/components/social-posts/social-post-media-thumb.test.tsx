import type { SocialPostMediaRef } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";

import { SocialPostMediaThumb } from "./social-post-media-thumb";

vi.mock("@/components/ui/file-chip-mini-preview", () => ({
  FileChipMiniPreview: vi.fn(() => (
    <div data-testid="file-chip-mini-preview" />
  )),
}));

const VIDEO: SocialPostMediaRef = {
  pathname: "drive/clip.mp4",
  fileUrl: "https://example.com/clip.mp4",
  name: "clip.mp4",
  size: 48_000,
  mimeType: "video/mp4",
  kind: "video",
};

const IMAGE: SocialPostMediaRef = {
  ...VIDEO,
  pathname: "drive/photo.png",
  fileUrl: "https://example.com/photo.png",
  name: "photo.png",
  mimeType: "image/png",
  kind: "image",
};

const GIF: SocialPostMediaRef = {
  ...IMAGE,
  pathname: "drive/animation.gif",
  fileUrl: "https://example.com/animation.gif",
  name: "animation.gif",
  mimeType: "image/gif",
  kind: "gif",
};

describe("SocialPostMediaThumb", () => {
  it.each([IMAGE, GIF])(
    "renders a $kind thumb with the shared mini preview and no play mark",
    (media) => {
      render(<SocialPostMediaThumb media={media} />);

      expect(screen.getByTestId("file-chip-mini-preview")).toBeVisible();
      expect(vi.mocked(FileChipMiniPreview).mock.lastCall?.[0]).toEqual({
        fileName: media.name,
        mediaType: media.mimeType,
        size: media.size,
        sizeClass: "size-12",
        url: media.fileUrl,
      });
      expect(
        screen.queryByTestId("social-post-media-video-play"),
      ).not.toBeInTheDocument();
    },
  );

  it("marks a video thumb with a play badge", () => {
    render(<SocialPostMediaThumb media={VIDEO} />);
    const link = screen.getByRole("link", { name: VIDEO.name });
    const playMark = screen.getByTestId("social-post-media-video-play");

    expect(link).toHaveAttribute("href", VIDEO.fileUrl);
    expect(link).toContainElement(playMark);
    expect(playMark).toBeVisible();
    expect(playMark).toHaveAttribute("aria-hidden", "true");
    expect(playMark).toHaveClass("pointer-events-none");
  });
});
