import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { StudioGallery } from "./studio-gallery";
import type { StudioAsset } from "./types";

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "today" }),
}));

const ASSET = {
  id: "a",
  rootId: "a",
  parentId: null,
  version: 1,
  prompt: "sample",
  model: "vendor/model-a",
  width: 1024,
  height: 1024,
  bytes: 1000,
  contentType: "image/png",
  createdAt: "2026-09-26T00:00:00Z",
  jobId: "j",
  settings: { outputFormat: "png" },
  contentPath: "/a",
} as unknown as StudioAsset;

function mount() {
  return render(
    <StudioGallery
      activeJobs={[]}
      assets={[ASSET]}
      cancelRequestedJobIds={[]}
      catalog={TEST_CATALOG}
      labels={TEST_LABELS}
      onCancelJob={vi.fn()}
      onOpen={vi.fn()}
      onReroll={vi.fn()}
      onReusePrompt={vi.fn()}
      onToggleSelect={vi.fn()}
      onVariation={vi.fn()}
      queued={[]}
      selectedIds={[]}
    />,
  );
}

describe("studio gallery action tooltips", () => {
  it("keeps accessible names and shows a tooltip instead of a native title", async () => {
    const user = userEvent.setup();
    mount();

    const reroll = screen.getByRole("button", { name: "reroll" });
    expect(reroll).not.toHaveAttribute("title");
    expect(
      screen.getByRole("button", { name: "regenerate" }),
    ).not.toHaveAttribute("title");
    expect(
      screen.getByRole("button", { name: "reusePrompt" }),
    ).not.toHaveAttribute("title");
    expect(screen.getByRole("link", { name: "download" })).not.toHaveAttribute(
      "title",
    );
    expect(screen.getByRole("button", { name: "select" })).not.toHaveAttribute(
      "title",
    );

    await user.hover(reroll);
    expect(
      await screen.findByRole("tooltip", { name: "reroll" }),
    ).toBeVisible();
  });
});
