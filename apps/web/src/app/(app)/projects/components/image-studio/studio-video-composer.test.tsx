import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import {
  carryVideoSettings,
  StudioVideoComposer,
  type StudioVideoDraft,
  videoDraftFor,
} from "./studio-video-composer";
import type { StudioAsset } from "./types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/components/ui/popover", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Popover: Passthrough,
    PopoverTrigger: Passthrough,
    PopoverContent: Passthrough,
  };
});

const [TEXT_MODEL, IMAGE_MODEL] = TEST_CATALOG.videoModels;

const SOURCE = {
  id: "asset-1",
  projectId: "project-1",
  version: 3,
  mediaType: "IMAGE",
} as StudioAsset;

function renderComposer(
  overrides: Partial<{
    draft: StudioVideoDraft;
    prompt: string;
    source: StudioAsset | null;
    canGenerate: boolean;
  }> = {},
) {
  const onGenerate = vi.fn();
  render(
    <StudioVideoComposer
      busy={false}
      canGenerate={overrides.canGenerate ?? true}
      catalog={TEST_CATALOG}
      draft={overrides.draft ?? videoDraftFor(TEXT_MODEL!)}
      labels={TEST_LABELS}
      modeSwitch={null}
      onClearSource={vi.fn()}
      onDraftChange={vi.fn()}
      onGenerate={onGenerate}
      onPromptChange={vi.fn()}
      prompt={overrides.prompt ?? "A harbour at dawn"}
      promptRef={createRef()}
      source={overrides.source ?? null}
    />,
  );
  return { onGenerate };
}

describe("videoDraftFor", () => {
  it("opens on 9:16, five seconds and the model's first resolution", () => {
    expect(videoDraftFor(TEXT_MODEL!).settings).toEqual({
      aspectRatio: "9:16",
      durationSeconds: 5,
      resolution: "768P",
    });
  });

  it("sends no frame for a model that follows its image", () => {
    expect(videoDraftFor(IMAGE_MODEL!).settings.aspectRatio).toBe("");
  });

  it("keeps a length both models offer and resets what the new one lacks", () => {
    expect(
      carryVideoSettings(IMAGE_MODEL!, {
        aspectRatio: "16:9",
        durationSeconds: 10,
        resolution: "768P",
      }),
    ).toEqual({ aspectRatio: "", durationSeconds: 10, resolution: "720p" });
  });
});

describe("StudioVideoComposer", () => {
  it("quotes the clip in credits by the function Core charges with", () => {
    renderComposer();
    // $0.04/s at 768P for five seconds.
    expect(
      screen.getAllByText('creditsCount:{"count":20}').length,
    ).toBeGreaterThan(0);
  });

  it("generates on submit when there is a brief and a project", () => {
    const { onGenerate } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "generateVideo" }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it("will not generate without a brief", () => {
    const empty = renderComposer({ prompt: "  " });
    fireEvent.click(screen.getByRole("button", { name: "generateVideo" }));
    expect(empty.onGenerate).not.toHaveBeenCalled();
  });

  it("will not generate without a project, and says why", () => {
    const noProject = renderComposer({ canGenerate: false });
    fireEvent.click(screen.getByRole("button", { name: "generateVideo" }));
    expect(noProject.onGenerate).not.toHaveBeenCalled();
    expect(screen.getByText("videoNeedsProject")).toBeTruthy();
  });

  it("names the image being animated and offers only image models", () => {
    renderComposer({ draft: videoDraftFor(IMAGE_MODEL!), source: SOURCE });
    expect(screen.getByText("animating")).toBeTruthy();
    expect(screen.getByText("v3")).toBeTruthy();
    expect(screen.getAllByText("Animate A").length).toBeGreaterThan(0);
    expect(screen.queryByText("Video A")).toBeNull();
  });
});
