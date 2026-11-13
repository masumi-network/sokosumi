import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en.json";

import { canCompareStudioAsset } from "./studio-batch";
import { StudioCompare } from "./studio-compare";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { StudioGallery } from "./studio-gallery";
import { StudioLightbox } from "./studio-lightbox";
import type { StudioAsset } from "./types";

const mocks = vi.hoisted(() => ({
  getPair: vi.fn(),
  save: vi.fn(),
  listBatch: vi.fn(),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  getStudioComparePair: mocks.getPair,
  saveStudioPairwisePick: mocks.save,
  listStudioBatchAssets: mocks.listBatch,
}));

const A: StudioAsset = {
  id: "asset-a",
  projectId: "project",
  projectName: "Campaign",
  batchId: "batch",
  rootId: "asset-a",
  parentId: null,
  version: 1,
  prompt: "A red fox",
  model: "vendor/model-a",
  width: 1024,
  height: 1024,
  bytes: 1000,
  contentType: "image/png",
  mediaType: "IMAGE",
  video: null,
  createdAt: new Date("2026-11-13T12:00:00Z"),
  jobId: "job-a",
  settings: { aspectRatio: "1:1", outputFormat: "png" },
  contentPath: "/a",
};
const B: StudioAsset = {
  ...A,
  id: "asset-b",
  rootId: "asset-b",
  model: "vendor/model-b",
};

function mount(strict = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  const content = (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <StudioCompare
          batchId="batch"
          catalog={TEST_CATALOG}
          labels={TEST_LABELS}
          onClose={onClose}
          projectId="project"
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{content}</StrictMode> : content);
  return { onClose, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPair.mockResolvedValue({
    ok: true,
    value: { pair: { a: A, b: B } },
  });
  mocks.save.mockResolvedValue({ ok: true, value: { id: "pick" } });
});

describe("batch comparisons", () => {
  it("hides models until a saved pick, advances automatically, and finishes", async () => {
    const nextA = { ...A, id: "next-a", prompt: "A second brief" };
    const nextB = { ...B, id: "next-b", prompt: "A second brief" };
    mocks.getPair
      .mockResolvedValueOnce({ ok: true, value: { pair: { a: A, b: B } } })
      .mockResolvedValueOnce({
        ok: true,
        value: { pair: { a: nextA, b: nextB } },
      })
      .mockResolvedValue({ ok: true, value: { pair: null } });
    const { onClose, client } = mount();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await screen.findByRole("button", { name: "A" });
    expect(screen.queryByText(/Model A|Model B/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    await screen.findByText("· Model A");
    expect(screen.getByText("· Model B")).toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledWith({
      projectId: "project",
      batchId: "batch",
      assetId: A.id,
      otherAssetId: B.id,
      outcome: "A",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["studio-model-scoreboard", "project"],
    });
    await screen.findAllByAltText("A second brief", {}, { timeout: 2500 });
    expect(screen.queryByText(/Model A|Model B/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    const done = await screen.findByRole(
      "button",
      { name: "Done" },
      { timeout: 2500 },
    );
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ["ArrowLeft", "A"],
    ["ArrowRight", "B"],
    ["ArrowUp", "TIE"],
    ["ArrowDown", "BOTH_BAD"],
    ["1", "A"],
    ["2", "B"],
    ["3", "TIE"],
    ["4", "BOTH_BAD"],
  ])("records %s as %s", async (key, outcome) => {
    mount();
    await screen.findByRole("button", { name: "A" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key });
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome }),
      ),
    );
  });

  it("ignores modified and held shortcuts and blocks duplicate picks while saving", async () => {
    let resolveSave: (value: { ok: true; value: { id: string } }) => void =
      () => {};
    mocks.save.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    mount();
    await screen.findByRole("button", { name: "A" });
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "1", metaKey: true });
    fireEvent.keyDown(dialog, { key: "1", repeat: true });
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "1" });
    fireEvent.keyDown(dialog, { key: "2" });
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "B" })).toBeDisabled();
    expect(dialog).toHaveFocus();
    await act(async () => resolveSave({ ok: true, value: { id: "pick" } }));
  });

  it("keeps models hidden after a failed save and lets the pick be retried", async () => {
    mocks.save.mockResolvedValueOnce({
      ok: false,
      error: { message: "Unavailable" },
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Tie" }));
    await screen.findByText("Failed to save comparison. Try again.");
    expect(screen.queryByText(/Model A|Model B/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tie" }));
    await screen.findByText("· Model A");
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it("retries a failed pair fetch", async () => {
    mocks.getPair.mockResolvedValueOnce({
      ok: false,
      error: { message: "Unavailable" },
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "Both bad" }),
    ).toBeEnabled();
  });

  it("reveals a saved pick after StrictMode remounts effects", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "A" }));
    expect(await screen.findByText("· Model A")).toBeInTheDocument();
  });

  it.each(["Escape", "Done"])(
    "restores the entry's keyboard focus after %s",
    async (close) => {
      mocks.getPair.mockResolvedValue({ ok: true, value: { pair: null } });
      function Harness() {
        const [open, setOpen] = useState(false);
        const trigger = useRef<HTMLButtonElement>(null);
        return (
          <>
            <button onClick={() => setOpen(true)} ref={trigger} type="button">
              Compare batch
            </button>
            {open ? (
              <StudioCompare
                batchId="batch"
                catalog={TEST_CATALOG}
                labels={TEST_LABELS}
                onClose={() => setOpen(false)}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  trigger.current?.focus();
                }}
                projectId="project"
              />
            ) : null}
          </>
        );
      }
      render(
        <QueryClientProvider client={new QueryClient()}>
          <NextIntlClientProvider
            locale="en"
            messages={messages}
            timeZone="UTC"
          >
            <Harness />
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );
      const entry = screen.getByRole("button", { name: "Compare batch" });
      entry.focus();
      fireEvent.click(entry);
      const done = await screen.findByRole("button", { name: "Done" });
      if (close === "Done") fireEvent.click(done);
      else fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() => expect(entry).toHaveFocus());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );
});

describe("compare entry", () => {
  function mountLightbox() {
    const client = new QueryClient();
    const onCompare = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <StudioLightbox
            assets={[A]}
            catalog={TEST_CATALOG}
            creditsByAssetId={{}}
            elapsedByAssetId={{}}
            labels={TEST_LABELS}
            onCaptionChange={vi.fn()}
            onClose={vi.fn()}
            onCompare={onCompare}
            onSelect={vi.fn()}
            siblings={[A]}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    return { client, onCompare };
  }

  it("finds compatible siblings outside the loaded gallery in the lightbox", async () => {
    mocks.listBatch.mockResolvedValue([A, B]);
    const { onCompare } = mountLightbox();
    fireEvent.click(await screen.findByRole("button", { name: "compare" }));
    expect(mocks.listBatch).toHaveBeenCalledWith({
      projectId: "project",
      batchId: "batch",
    });
    expect(onCompare).toHaveBeenCalledWith(A);
  });

  it("retries the lightbox batch lookup after a connection failure", async () => {
    mocks.listBatch
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue([A, B]);
    mountLightbox();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "compare" }),
    ).toBeInTheDocument();
  });

  it.each([
    [A],
    [A, { ...B, settings: { aspectRatio: "4:5" as const } }],
    [A, { ...B, prompt: "Another brief" }],
  ])(
    "keeps Compare hidden for an incompatible full batch %#",
    async (...assets) => {
      mocks.listBatch.mockResolvedValue(assets);
      const { client } = mountLightbox();
      await waitFor(() =>
        expect(
          client.getQueryState(["studio-batch-assets", "project", "batch"])
            ?.status,
        ).toBe("success"),
      );
      expect(
        screen.queryByRole("button", { name: "compare" }),
      ).not.toBeInTheDocument();
    },
  );

  it("requires another image in the same project, batch, brief, and placement", () => {
    expect(canCompareStudioAsset(A, [A])).toBe(false);
    for (const incompatible of [
      { ...B, projectId: "other" },
      { ...B, batchId: "other" },
      { ...B, prompt: "A different brief" },
      { ...B, mediaType: "VIDEO" as const },
      { ...B, settings: { aspectRatio: "4:5" as const } },
    ])
      expect(canCompareStudioAsset(A, [A, incompatible])).toBe(false);
    expect(canCompareStudioAsset(A, [A, B])).toBe(true);
  });

  it("opens the compatible batch from a gallery tile", () => {
    const onCompare = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <StudioGallery
          activeJobs={[]}
          assets={[A, B]}
          cancelRequestedJobIds={[]}
          catalog={TEST_CATALOG}
          labels={TEST_LABELS}
          onCompare={onCompare}
          onOpen={vi.fn()}
          onToggleSelect={vi.fn()}
          queued={[]}
          selectedIds={[]}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "compare" })[0]);
    expect(onCompare).toHaveBeenCalledWith(B);
  });
});
