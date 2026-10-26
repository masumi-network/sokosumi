import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { StudioGallery } from "./studio-gallery";
import { StudioLightbox } from "./studio-lightbox";
import type { StudioAsset, StudioCatalog } from "./types";

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "today" }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/image-viewer", () => ({
  ImageViewer: ({ aside }: { aside?: React.ReactNode }) => (
    <section aria-label="Image details">{aside}</section>
  ),
}));

const ASSET: StudioAsset = {
  id: "asset-a",
  projectId: "project-a",
  projectName: "Campaign",
  rootId: "asset-a",
  parentId: null,
  version: 1,
  prompt: "A campaign image",
  model: "vendor/model-a",
  width: 1024,
  height: 1024,
  bytes: 1000,
  contentType: "image/png",
  mediaType: "IMAGE",
  video: null,
  createdAt: new Date("2026-09-26T00:00:00Z"),
  jobId: "job-a",
  settings: { aspectRatio: "1:1", resolution: "1K", outputFormat: "png" },
  contentPath: "/asset-a",
};

it("keeps Schedule and Refine available when the original model cannot vary", async () => {
  const onSchedule = vi
    .fn<(asset: StudioAsset) => Promise<void>>()
    .mockResolvedValue();
  const onRefine = vi.fn();
  const catalog: StudioCatalog = {
    ...TEST_CATALOG,
    models: TEST_CATALOG.models.map((model) => ({
      ...model,
      editEndpoint: null,
      maxReferences: 0,
    })),
  };
  render(
    <StudioLightbox
      assets={[ASSET]}
      catalog={catalog}
      creditsByAssetId={{}}
      elapsedByAssetId={{}}
      labels={TEST_LABELS}
      onClose={vi.fn()}
      onRegenerate={vi.fn()}
      onSchedule={onSchedule}
      onSelect={vi.fn()}
      onUseAsReference={onRefine}
      siblings={[ASSET]}
    />,
  );

  expect(
    screen.queryByRole("button", { name: "regenerate" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "schedule" }));
  });
  expect(onSchedule).toHaveBeenCalledExactlyOnceWith(ASSET);
  fireEvent.click(screen.getByRole("button", { name: "refine" }));
  expect(onRefine).toHaveBeenCalledExactlyOnceWith(ASSET);
});

function mount(
  surface: "gallery" | "lightbox",
  catalog = TEST_CATALOG,
  asset = ASSET,
) {
  const onVariation = vi.fn();
  if (surface === "gallery") {
    render(
      <StudioGallery
        activeJobs={[]}
        assets={[asset]}
        cancelRequestedJobIds={[]}
        catalog={catalog}
        labels={TEST_LABELS}
        onCancelJob={vi.fn()}
        onOpen={vi.fn()}
        onReroll={vi.fn()}
        onReusePrompt={vi.fn()}
        onToggleSelect={vi.fn()}
        onVariation={onVariation}
        queued={[]}
        selectedIds={[]}
      />,
    );
  } else {
    render(
      <StudioLightbox
        assets={[asset]}
        catalog={catalog}
        creditsByAssetId={{}}
        elapsedByAssetId={{}}
        labels={TEST_LABELS}
        onClose={vi.fn()}
        onRegenerate={onVariation}
        onSelect={vi.fn()}
        onUseAsReference={vi.fn()}
        siblings={[asset]}
      />,
    );
  }
  return onVariation;
}

describe.each(["gallery", "lightbox"] as const)("%s variation", (surface) => {
  it("offers a variation for a known model that can edit this image", () => {
    const onVariation = mount(surface);
    fireEvent.click(screen.getByRole("button", { name: "regenerate" }));
    expect(onVariation).toHaveBeenCalledExactlyOnceWith(ASSET);
  });

  it.each([
    { name: "generation-only", editEndpoint: null, maxReferences: 4 },
    {
      name: "no reference support",
      editEndpoint: "vendor/model-a/edit",
      maxReferences: 0,
    },
  ])(
    "does not offer a doomed request for $name models",
    ({ editEndpoint, maxReferences }) => {
      const catalog: StudioCatalog = {
        ...TEST_CATALOG,
        models: TEST_CATALOG.models.map((model) =>
          model.id === "model-a"
            ? { ...model, editEndpoint, maxReferences }
            : model,
        ),
      };
      const onVariation = mount(surface, catalog);
      expect(
        screen.queryByRole("button", { name: "regenerate" }),
      ).not.toBeInTheDocument();
      expect(onVariation).not.toHaveBeenCalled();
      // The separate editing path can still let the person choose another model.
      expect(
        screen.getByRole("button", {
          name: surface === "gallery" ? "reusePrompt" : "refine",
        }),
      ).toBeEnabled();
    },
  );

  it("does not silently offer a variation on the default for a withdrawn original", () => {
    const onVariation = mount(surface, TEST_CATALOG, {
      ...ASSET,
      model: "vendor/retired",
    });
    expect(
      screen.queryByRole("button", { name: "regenerate" }),
    ).not.toBeInTheDocument();
    expect(onVariation).not.toHaveBeenCalled();
  });
});
