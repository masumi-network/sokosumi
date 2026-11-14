import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { StudioGallery } from "./studio-gallery";
import type { StudioAsset } from "./types";

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "today" }),
  useTranslations: () => (key: string) => key,
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

function mount(readOnly = false) {
  const handlers = {
    onReroll: vi.fn(),
    onReusePrompt: vi.fn(),
    onVariation: vi.fn(),
  };
  render(
    <StudioGallery
      activeJobs={[]}
      assets={[ASSET]}
      cancelRequestedJobIds={[]}
      catalog={TEST_CATALOG}
      labels={TEST_LABELS}
      onOpen={vi.fn()}
      onToggleSelect={vi.fn()}
      queued={[]}
      selectedIds={[]}
      {...(readOnly ? {} : handlers)}
    />,
  );
  return handlers;
}

describe("studio gallery tile actions on touch", () => {
  it("hides the hover row and shows one menu button where there is no hover", () => {
    mount();

    const row = screen.getByRole("button", { name: "reroll" }).parentElement;
    expect(row?.className).toContain("[@media(hover:none)]:hidden");
    expect(row?.className).not.toContain("[@media(hover:none)]:opacity-100");

    const more = screen.getByRole("button", { name: "moreActions" });
    expect(more.className).toContain("hidden");
    expect(more.className).toContain("[@media(hover:none)]:flex");
  });

  it("offers every tile action, by name, in the menu", async () => {
    const user = userEvent.setup();
    const { onReroll, onVariation, onReusePrompt } = mount();

    await user.click(screen.getByRole("button", { name: "moreActions" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["reroll", "regenerate", "reusePrompt", "download"]);
    expect(
      within(menu).getByRole("menuitem", { name: "download" }),
    ).toHaveAttribute("download", "v1.png");

    await user.click(within(menu).getByRole("menuitem", { name: "reroll" }));
    expect(onReroll).toHaveBeenCalledWith(ASSET);

    await user.click(screen.getByRole("button", { name: "moreActions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "regenerate" }),
    );
    expect(onVariation).toHaveBeenCalledWith(ASSET);

    await user.click(screen.getByRole("button", { name: "moreActions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "reusePrompt" }),
    );
    expect(onReusePrompt).toHaveBeenCalledWith(ASSET);
  });

  it("keeps only download in a read-only studio's menu", async () => {
    const user = userEvent.setup();
    mount(true);

    await user.click(screen.getByRole("button", { name: "moreActions" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["download"]);
  });
});
