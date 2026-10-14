import type { SocialPostMediaRef } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SocialPostMediaThumb } from "./social-post-media-thumb";

const VIDEO: SocialPostMediaRef = {
  pathname: "drive/clip.mp4",
  fileUrl: "https://example.com/clip.mp4",
  name: "clip.mp4",
  size: 48_000,
  mimeType: "video/mp4",
  kind: "video",
};

describe("SocialPostMediaThumb", () => {
  it("marks a video thumb with a play badge", () => {
    render(<SocialPostMediaThumb media={VIDEO} />);
    expect(screen.getByRole("link", { name: "clip.mp4" })).toHaveAttribute(
      "href",
      VIDEO.fileUrl,
    );
    expect(screen.getByTestId("social-post-media-video-play")).toBeVisible();
  });
});
