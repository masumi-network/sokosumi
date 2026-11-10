import type { StudioProductPhoto } from "@sokosumi/core-client";
import { MAX_STUDIO_BATCH_IMAGES as MAX_BATCH } from "@sokosumi/utils";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { StudioBatchProduct } from "./studio-batch";
import { StudioComposer } from "./studio-composer";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type { StudioCatalog, StudioTarget } from "./types";
import type { GenerationRequest } from "./use-generation-queue";

const { uploadPhoto } = vi.hoisted(() => ({ uploadPhoto: vi.fn() }));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: async () => ({
      data: { session: { activeOrganizationId: "workspace-org" } },
    }),
  },
}));

vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  uploadDriveFile: uploadPhoto,
  isDriveFileUploadDuplicate: () => false,
}));

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

const SETTINGS: StudioTarget["settings"] = {
  aspectRatio: "1:1",
  resolution: "1K",
  outputFormat: "png",
  seed: null,
};

const LARGE_CATALOG: StudioCatalog = {
  ...TEST_CATALOG,
  models: Array.from({ length: MAX_BATCH + 4 }, (_, index) => ({
    ...TEST_CATALOG.models[0],
    id: `many-${index}`,
    label: `Many ${index}`,
  })),
};

const BATCH_PRODUCTS: StudioBatchProduct[] = [
  {
    product: {
      id: "vase",
      name: "Vase",
      description: "Terracotta",
      price: "EUR 12",
      url: null,
      imageUrl: null,
    },
    photo: { id: "vase-file", name: "Vase photo" },
    copies: 2,
  },
  {
    product: {
      id: "mug",
      name: "Mug",
      description: "Porcelain",
      price: "EUR 9",
      url: null,
      imageUrl: null,
    },
    photo: { id: "mug-file", name: "Mug photo" },
    copies: 1,
  },
];

function Harness({
  catalog = LARGE_CATALOG,
  initial,
  onGenerate,
  productPhotos = false,
  batchProducts,
}: {
  catalog?: StudioCatalog;
  initial: StudioTarget;
  onGenerate: (requests: GenerationRequest[]) => void;
  productPhotos?: boolean;
  batchProducts?: StudioBatchProduct[];
}) {
  const [target, setTarget] = useState(initial);
  const [prompt, setPrompt] = useState("A campaign image");
  const [photo, setPhoto] = useState<StudioProductPhoto | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  return (
    <StudioComposer
      batchProducts={batchProducts}
      busy={false}
      catalog={catalog}
      labels={TEST_LABELS}
      onApplyTemplate={(template) => {
        setPrompt(template.prompt);
        setTarget((current) => ({
          ...current,
          settings: { ...current.settings, aspectRatio: template.aspectRatio },
        }));
      }}
      onClearReferences={() => {}}
      onGenerate={onGenerate}
      onProductPhotoChange={productPhotos ? setPhoto : undefined}
      onPhotoUploadChange={setUploadingPhoto}
      uploadingPhoto={uploadingPhoto}
      onPromptChange={setPrompt}
      productPhoto={photo}
      onTargetChange={setTarget}
      prompt={prompt}
      referenceAssets={[]}
      target={target}
    />
  );
}

function modelEntry(label: string) {
  const entry = screen
    .getAllByRole("checkbox")
    .find((node) => node.textContent?.startsWith(label));
  if (!entry) throw new Error(`Missing model ${label}`);
  return entry;
}

function selectedLabels() {
  return screen
    .getAllByRole("checkbox", { checked: true })
    .map((node) => node.textContent);
}

function generate() {
  fireEvent.click(screen.getByRole("button", { name: /^generate/ }));
}

describe("an honest generation plan", () => {
  it("uses the selected creative direction without changing the written brief", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ modelIds: ["model-a"], settings: SETTINGS }}
        onGenerate={onGenerate}
      />,
    );
    const box = screen.getByRole("textbox", {
      name: TEST_LABELS.promptPlaceholder,
    });
    const spotlight = screen.getByRole("button", {
      name: "CreativeDirections.spotlight",
    });
    fireEvent.click(spotlight);
    expect(spotlight).toHaveAttribute("aria-pressed", "true");
    expect(box).toHaveValue("A campaign image");
    generate();
    expect(onGenerate.mock.calls[0][0][0].prompt).toContain(
      "A campaign image\n\nCreative direction: Make the product the visual focal point.",
    );

    fireEvent.change(box, { target: { value: "" } });
    generate();
    expect(onGenerate).toHaveBeenCalledTimes(1);

    fireEvent.change(box, { target: { value: "A campaign image" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "CreativeDirections.auto",
      }),
    );
    generate();
    expect(onGenerate.mock.calls[1][0][0].prompt).toBe("A campaign image");
  });

  it("uploads a product photo to the active workspace and sends it to every placement", async () => {
    const pendingUpload = Promise.withResolvers<{ resourceId: string }>();
    uploadPhoto.mockReturnValueOnce(pendingUpload.promise);
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ modelIds: ["model-a"], settings: SETTINGS }}
        onGenerate={onGenerate}
        productPhotos
      />,
    );

    const photo = new File(["image"], "product.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("productPhoto"), {
      target: { files: [photo] },
    });

    expect(screen.getByRole("button", { name: /^generate/ })).toBeDisabled();
    await act(async () => pendingUpload.resolve({ resourceId: "photo-1" }));
    expect(await screen.findByText("product.png")).toBeInTheDocument();
    expect(screen.getByText("productPhotoGuidance")).toBeInTheDocument();
    expect(uploadPhoto).toHaveBeenCalledWith(photo, {
      scope: "org",
      organizationId: "workspace-org",
    });
    for (const placement of ["squareFeed", "stories"]) {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(placement) }),
      );
    }
    generate();
    expect(
      onGenerate.mock.calls[0][0].map((request) => request.referenceFileIds),
    ).toEqual([["photo-1"], ["photo-1"]]);

    fireEvent.click(screen.getByRole("button", { name: "removeProductPhoto" }));
    expect(screen.queryByText("productPhotoGuidance")).toBeNull();
    generate();
    expect(
      onGenerate.mock.calls[1][0].map((request) => request.referenceFileIds),
    ).toEqual([undefined, undefined]);
  });

  it("prices each product copy across placements and sends only that product's brief and photo", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        batchProducts={BATCH_PRODUCTS}
        catalog={TEST_CATALOG}
        initial={{
          modelIds: ["model-a"],
          settings: SETTINGS,
          placementRatios: ["1:1", "9:16"],
        }}
        onGenerate={onGenerate}
      />,
    );
    expect(
      screen.getByText('placementPlanCredits:{"count":6,"credits":24}'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "CreativeDirections.explainer",
      }),
    );
    generate();

    const requests = onGenerate.mock.calls[0][0];
    expect(requests).toHaveLength(6);
    expect(
      new Set(requests.map(({ idempotencyKey }) => idempotencyKey)).size,
    ).toBe(6);
    expect(
      requests.map(({ referenceFileIds }) => referenceFileIds?.[0]),
    ).toEqual([
      "vase-file",
      "vase-file",
      "vase-file",
      "vase-file",
      "mug-file",
      "mug-file",
    ]);
    expect(requests.map(({ settings }) => settings.aspectRatio)).toEqual([
      "1:1",
      "9:16",
      "1:1",
      "9:16",
      "1:1",
      "9:16",
    ]);
    expect(requests[0].prompt).toBe(requests[1].prompt);
    expect(requests[2].prompt).toBe(requests[3].prompt);
    expect(requests[0].prompt).toContain("Ad variation: Frame the product");
    expect(requests[2].prompt).toContain("Ad variation: Place the product");
    expect(requests[4].prompt).toBe(requests[5].prompt);
    expect(requests[4].prompt).not.toContain("Ad variation:");
    expect(screen.getByText("variedAdCopies")).toBeInTheDocument();
    for (const request of requests) {
      const isVase = request.referenceFileIds?.[0] === "vase-file";
      expect(request.product).toEqual(
        isVase ? { id: "vase", name: "Vase" } : { id: "mug", name: "Mug" },
      );
      expect(request.prompt).toContain(isVase ? "Vase" : "Mug");
      expect(request.prompt).not.toContain(isVase ? "Mug" : "Vase");
      expect(request.prompt).toContain(
        "Creative direction: Illustrate how the product works",
      );
    }
  });

  it("uses distinct treatments for a full batch and replaces an existing treatment when reused", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        batchProducts={[{ ...BATCH_PRODUCTS[0], copies: MAX_BATCH }]}
        catalog={TEST_CATALOG}
        initial={{
          modelIds: ["model-a"],
          settings: { ...SETTINGS, seed: 42 },
        }}
        onGenerate={onGenerate}
      />,
    );
    generate();
    const requests = onGenerate.mock.calls[0][0];
    expect(new Set(requests.map(({ prompt }) => prompt)).size).toBe(MAX_BATCH);
    expect(new Set(requests.map(({ settings }) => settings.seed))).toEqual(
      new Set([42]),
    );

    const treatment = requests[0].prompt.split("\n\nAd variation:")[1];
    fireEvent.change(
      screen.getByRole("textbox", { name: TEST_LABELS.promptPlaceholder }),
      { target: { value: `A campaign image\n\nAd variation:${treatment}` } },
    );
    generate();
    expect(onGenerate.mock.calls[1][0].map(({ prompt }) => prompt)).toEqual(
      requests.map(({ prompt }) => prompt),
    );
  });

  it("preserves the full brief when there is no room for variation guidance", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ modelIds: ["model-a"], settings: SETTINGS }}
        onGenerate={onGenerate}
      />,
    );
    const prompt = "x".repeat(4_000);
    fireEvent.change(
      screen.getByRole("textbox", { name: TEST_LABELS.promptPlaceholder }),
      { target: { value: prompt } },
    );
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.queryByText("variedAdCopies")).toBeNull();
    generate();
    expect(
      onGenerate.mock.calls[0][0].map((request) => request.prompt),
    ).toEqual([prompt, prompt]);
  });

  it("fits an oversized product batch by keeping selected models and leaving placements and copies intact", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    const incompatible = {
      ...TEST_CATALOG.models[0],
      aspectRatios: ["1:1"],
    };
    render(
      <Harness
        batchProducts={BATCH_PRODUCTS}
        catalog={{
          ...LARGE_CATALOG,
          models: [incompatible, ...LARGE_CATALOG.models.slice(0, 2)],
        }}
        initial={{
          modelIds: [incompatible.id, "many-0", "many-1"],
          settings: SETTINGS,
          placementRatios: ["1:1", "9:16"],
        }}
        onGenerate={onGenerate}
      />,
    );
    expect(
      screen.getByText('productBatchLimit:{"count":12}', {
        selector: '[role="alert"]',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("unsupportedPlacements")).toBeInTheDocument();
    generate();
    expect(onGenerate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: 'fitBatchModels:{"count":2}' }),
    );
    expect(onGenerate).not.toHaveBeenCalled();
    expect(modelEntry(incompatible.label)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    generate();
    const requests = onGenerate.mock.calls[0][0];
    expect(requests).toHaveLength(MAX_BATCH);
    expect(new Set(requests.map(({ modelId }) => modelId))).toEqual(
      new Set(["many-0", "many-1"]),
    );
    expect(requests.map(({ settings }) => settings.aspectRatio)).toEqual(
      Array.from({ length: 3 }, () => ["1:1", "1:1", "9:16", "9:16"]).flat(),
    );
  });

  it("selects only models that fit and buys every checked model", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        initial={{ modelIds: ["many-15"], settings: SETTINGS }}
        onGenerate={onGenerate}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: 'selectModelsUpToLimit:{"count":12}',
      }),
    );

    expect(selectedLabels()).toHaveLength(MAX_BATCH);
    expect(modelEntry("Many 15")).toHaveAttribute("aria-checked", "true");
    expect(modelEntry("Many 11")).toHaveAttribute("aria-checked", "false");
    generate();
    const requests = onGenerate.mock.calls[0][0];
    expect(requests).toHaveLength(MAX_BATCH);
    expect(requests.map((request) => request.modelId)).toEqual([
      ...Array.from({ length: 11 }, (_, index) => `many-${index}`),
      "many-15",
    ]);
  });

  it("explains and refuses a thirteenth model until another is removed", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        initial={{
          modelIds: LARGE_CATALOG.models
            .slice(0, MAX_BATCH)
            .map((model) => model.id),
          settings: SETTINGS,
        }}
        onGenerate={onGenerate}
      />,
    );
    const extra = modelEntry("Many 12");
    expect(extra).toHaveAttribute("aria-disabled", "true");
    expect(extra).toHaveAccessibleDescription(
      'modelSelectionLimit:{"count":12}',
    );
    fireEvent.click(extra);
    expect(selectedLabels()).toHaveLength(MAX_BATCH);
    expect(extra).toHaveAttribute("aria-checked", "false");

    fireEvent.click(modelEntry("Many 0"));
    fireEvent.click(extra);
    generate();
    const requests = onGenerate.mock.calls[0][0];
    expect(requests).toHaveLength(MAX_BATCH);
    expect(requests.some((request) => request.modelId === "many-12")).toBe(
      true,
    );
    expect(requests.some((request) => request.modelId === "many-0")).toBe(
      false,
    );
  });

  it("limits filtered bulk selection without promising to select all matches", () => {
    render(
      <Harness
        initial={{
          modelIds: LARGE_CATALOG.models
            .slice(0, MAX_BATCH - 1)
            .map((model) => model.id),
          settings: SETTINGS,
        }}
        onGenerate={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "searchModels" }), {
      target: { value: "Many 1" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: 'selectModelsUpToLimit:{"count":12}',
      }),
    );
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3);
    expect(modelEntry("Many 11")).toHaveAttribute("aria-checked", "true");
    expect(modelEntry("Many 12")).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("button", {
        name: 'selectModelsUpToLimit:{"count":12}',
      }),
    ).toBeDisabled();
  });

  it("refuses an over-limit restored target instead of silently dropping models", () => {
    const onGenerate = vi.fn();
    render(
      <Harness
        initial={{
          modelIds: LARGE_CATALOG.models
            .slice(0, MAX_BATCH + 1)
            .map((model) => model.id),
          settings: SETTINGS,
        }}
        onGenerate={onGenerate}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      'modelSelectionLimit:{"count":12}',
    );
    expect(screen.getByRole("button", { name: /^generate/ })).toBeDisabled();
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "promptPlaceholder" }),
      {
        key: "Enter",
        ctrlKey: true,
      },
    );
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("discloses each purchased frame after a template sets an unsupported ratio", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ modelIds: ["model-a", "model-b"], settings: SETTINGS }}
        onGenerate={onGenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "templates" }));
    fireEvent.click(screen.getByRole("button", { name: "story-ad" }));
    expect(screen.getByText("mixedSettings")).toBeInTheDocument();
    expect(screen.getAllByText("dimensions: 9:16 · 1K · png")).toHaveLength(2);
    expect(screen.getAllByText("dimensions: 1:1 · 1K · png")).toHaveLength(2);
    generate();
    expect(
      onGenerate.mock.calls[0][0].map(
        (request) => request.settings.aspectRatio,
      ),
    ).toEqual(["9:16", "1:1"]);
  });

  it("prices and submits the requested placements within the copy limit", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ modelIds: ["model-a"], settings: SETTINGS }}
        onGenerate={onGenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "4" }));
    for (const placement of [
      "squareFeed",
      "portraitFeed",
      "stories",
      "landscapeFeed",
    ]) {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(placement) }),
      );
    }

    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText('placementPlanCredits:{"count":12,"credits":48}'),
    ).toBeInTheDocument();
    generate();
    const requests = onGenerate.mock.calls[0][0];
    expect(requests.map(({ settings }) => settings.aspectRatio)).toEqual(
      Array.from({ length: 3 }, () => ["1:1", "4:5", "9:16", "16:9"]).flat(),
    );
    expect(
      new Set(requests.map(({ idempotencyKey }) => idempotencyKey)).size,
    ).toBe(MAX_BATCH);
  });

  it("keeps a selected placement visible and blocks incompatible batches", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ modelIds: ["model-a"], settings: SETTINGS }}
        onGenerate={onGenerate}
      />,
    );

    const stories = screen.getByRole("button", { name: /Placements.stories/ });
    fireEvent.click(stories);
    fireEvent.click(modelEntry("Model B"));
    expect(stories).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "unsupportedPlacements",
    );
    generate();
    expect(onGenerate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "4:5" }));
    expect(stories).toHaveAttribute("aria-pressed", "false");
    generate();
    expect(
      onGenerate.mock.calls[0][0].map(({ settings }) => settings.aspectRatio),
    ).toEqual(["4:5", "4:5"]);
  });

  it("shows and prices the same normalized settings it submits for each model", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    const inherited: StudioTarget["settings"] = {
      ...SETTINGS,
      aspectRatio: "9:16",
      resolution: "0.5K",
    };
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{
          modelIds: ["model-a", "model-b"],
          settings: inherited,
        }}
        onGenerate={onGenerate}
      />,
    );
    expect(screen.getByText("mixedSettings")).toBeInTheDocument();
    expect(
      screen.getByText('runPlanCredits:{"copies":1,"models":2,"credits":12}'),
    ).toBeInTheDocument();
    generate();
    const requests = onGenerate.mock.calls[0][0];
    expect(requests.map((request) => request.settings)).toEqual([
      inherited,
      SETTINGS,
    ]);
    expect(requests.map((request) => request.modelId)).toEqual([
      "model-a",
      "model-b",
    ]);
    for (const [index, request] of requests.entries()) {
      const { aspectRatio, resolution, outputFormat } = request.settings;
      const actualSettings = `dimensions: ${aspectRatio} · ${resolution} · ${outputFormat}`;
      expect(screen.getAllByText(actualSettings)).toHaveLength(2);
      const priceRow = screen
        .getByText(
          `creditsEach:${JSON.stringify({ credits: index === 0 ? 2 : 10, count: 1 })}`,
        )
        .closest("li");
      if (!priceRow) throw new Error(`Missing price for ${request.modelLabel}`);
      expect(
        within(priceRow).getByText(request.modelLabel),
      ).toBeInTheDocument();
      expect(within(priceRow).getByText(actualSettings)).toBeInTheDocument();
    }
  });

  it("summarizes a single model's normalized frame instead of inherited settings", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{
          modelIds: ["model-b"],
          settings: { ...SETTINGS, aspectRatio: "9:16", resolution: "0.5K" },
        }}
        onGenerate={onGenerate}
      />,
    );

    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();
    expect(screen.queryByText("9:16 · 0.5K · png")).not.toBeInTheDocument();
    expect(screen.queryByText("mixedSettings")).not.toBeInTheDocument();
    generate();
    expect(onGenerate.mock.calls[0][0]).toHaveLength(1);
    expect(onGenerate.mock.calls[0][0][0].settings).toEqual(SETTINGS);
  });

  it.each([
    { outputFormats: ["jpeg"], actualFormat: "jpeg", shownFormat: "jpeg" },
    {
      outputFormats: [],
      actualFormat: undefined,
      shownFormat: "modelChoosesFormat",
    },
  ] satisfies {
    outputFormats: StudioCatalog["models"][number]["outputFormats"];
    actualFormat: StudioTarget["settings"]["outputFormat"];
    shownFormat: string;
  }[])(
    "discloses mixed formats when a model uses $shownFormat",
    ({ outputFormats, actualFormat, shownFormat }) => {
      const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
      const catalog: StudioCatalog = {
        ...TEST_CATALOG,
        models: TEST_CATALOG.models.map((model) =>
          model.id === "model-b" ? { ...model, outputFormats } : model,
        ),
      };
      render(
        <Harness
          catalog={catalog}
          initial={{
            modelIds: ["model-a", "model-b"],
            settings: { ...SETTINGS, outputFormat: "webp" },
          }}
          onGenerate={onGenerate}
        />,
      );

      expect(screen.getByText("mixedSettings")).toBeInTheDocument();
      expect(screen.getAllByText("dimensions: 1:1 · 1K · webp")).toHaveLength(
        2,
      );
      expect(
        screen.getAllByText(`dimensions: 1:1 · 1K · ${shownFormat}`),
      ).toHaveLength(2);
      generate();
      expect(
        onGenerate.mock.calls[0][0].map(
          (request) => request.settings.outputFormat,
        ),
      ).toEqual(["webp", actualFormat]);
    },
  );
});
