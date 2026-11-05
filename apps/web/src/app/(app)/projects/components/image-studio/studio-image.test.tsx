import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TEST_LABELS } from "./studio-fixtures";
import { StudioImage } from "./studio-image";
import type { StudioAsset } from "./types";

const VIDEO = {
  id: "clip-1",
  projectId: "project-1",
  prompt: "A harbour at dawn",
  mediaType: "VIDEO",
} as StudioAsset;

describe("StudioImage for a video", () => {
  it("previews a tile as a muted, looping video from the content route", () => {
    const { container } = render(
      <StudioImage asset={VIDEO} labels={TEST_LABELS} />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe(
      "/api/projects/project-1/image-studio/assets/clip-1/content",
    );
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.hasAttribute("controls")).toBe(false);
    expect(container.querySelector("img")).toBeNull();
  });

  it("gives the lightbox real controls and sound", () => {
    const { container } = render(
      <StudioImage asset={VIDEO} controls labels={TEST_LABELS} />,
    );
    const video = container.querySelector("video");
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.muted).toBe(false);
  });
});
