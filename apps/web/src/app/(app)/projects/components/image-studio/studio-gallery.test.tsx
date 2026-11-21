import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

/**
 * A button inside a button is invalid HTML, and an unreadable picture carries
 * its own "Try again" button. So open-details covers the picture as an empty
 * sibling, and "Try again" sits beside it, after it in the tab order.
 */
describe("studio gallery tile structure", () => {
  function mountTile(asset: StudioAsset = ASSET) {
    const onOpen = vi.fn();
    render(
      <StudioGallery
        activeJobs={[]}
        assets={[asset]}
        cancelRequestedJobIds={[]}
        catalog={TEST_CATALOG}
        labels={TEST_LABELS}
        onOpen={onOpen}
        onToggleSelect={vi.fn()}
        queued={[]}
        selectedIds={[]}
      />,
    );
    return onOpen;
  }

  const openDetails = () =>
    screen.getByRole("button", { name: /^openDetails/ });

  /** Two failed loads and a 503 probe: the placeholder with "Try again". */
  async function breakThumbnail() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await act(async () => {
      fireEvent.error(screen.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await act(async () => {
      fireEvent.error(screen.getByRole("img"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return screen.getByRole("button", { name: /imageRetry/ });
  }

  it("keeps every control out of the open-details button", async () => {
    mountTile();
    expect(openDetails()).toBeEmptyDOMElement();

    const retry = await breakThumbnail();
    expect(openDetails()).toBeEmptyDOMElement();
    expect(openDetails().contains(retry)).toBe(false);
    // Same picture box: the cover and the placeholder share one parent.
    expect(retry.closest("figure > div")).toBe(openDetails().parentElement);
  });

  it("opens details from the picture", async () => {
    const user = userEvent.setup();
    const onOpen = mountTile();

    await user.click(openDetails());
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("reloads an unreadable picture on Try again without opening details", async () => {
    const user = userEvent.setup();
    const onOpen = mountTile();
    const retry = await breakThumbnail();

    await user.click(retry);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("img").getAttribute("src")).toContain("reload=1-");
  });

  it("tabs to open details, then to Try again", async () => {
    const user = userEvent.setup();
    mountTile();
    await breakThumbnail();

    await user.tab();
    expect(openDetails()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /imageRetry/ })).toHaveFocus();
  });

  it("plays a video tile's silent preview while the pointer is on it", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const user = userEvent.setup();
    mountTile({ ...ASSET, mediaType: "VIDEO" } as StudioAsset);

    await user.hover(openDetails());
    expect(play).toHaveBeenCalledTimes(1);
    await user.unhover(openDetails());
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
