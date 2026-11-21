import type { StudioProductPhoto } from "@sokosumi/core-client";
import { MAX_STUDIO_BATCH_IMAGES as MAX_BATCH } from "@sokosumi/utils";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { StudioBatchProduct } from "./studio-batch";
import { StudioComposer } from "./studio-composer";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type { StudioAsset, StudioCatalog, StudioTarget } from "./types";
import type { GenerationRequest } from "./use-generation-queue";

const { uploadPhoto, getBrandKit } = vi.hoisted(() => ({
  uploadPhoto: vi.fn(),
  getBrandKit: vi.fn(),
}));

// happy-dom has no layout for next/image to measure a `fill` parent by.
vi.mock("next/image", () => import("@/test/next-image"));

vi.mock("@/lib/actions/image-studio/brand-kit", () => ({
  getStudioBrandKit: getBrandKit,
}));

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

const LETTERING_CATALOG: StudioCatalog = {
  ...TEST_CATALOG,
  defaultModelId: "gemini-pro",
  models: [
    ...TEST_CATALOG.models,
    {
      ...TEST_CATALOG.models[0],
      id: "gemini-pro",
      label: "Gemini Pro",
      resolutions: ["1K", "2K"],
      price: {
        ...TEST_CATALOG.models[0].price,
        unitPriceUsd: 0.15,
        perImageUsd: { "1K": 0.15, "2K": 0.15 },
      },
    },
    {
      ...TEST_CATALOG.models[0],
      id: "ideogram-v3",
      label: "Ideogram v3",
      editEndpoint: "fal-ai/ideogram/v3/edit",
      resolutions: ["1K"],
      outputFormats: [],
      price: {
        ...TEST_CATALOG.models[0].price,
        unitPriceUsd: 0.03,
        perImageUsd: { "1K": 0.03 },
      },
    },
  ],
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
  catalog = TEST_CATALOG,
  initial,
  onGenerate,
  productPhotos = false,
  batchProducts,
  generationProjectId,
  referenceAssets = [],
}: {
  catalog?: StudioCatalog;
  initial: StudioTarget;
  onGenerate: (requests: GenerationRequest[]) => void;
  productPhotos?: boolean;
  batchProducts?: StudioBatchProduct[];
  generationProjectId?: string;
  referenceAssets?: StudioAsset[];
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
      generationProjectId={generationProjectId}
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
      referenceAssets={referenceAssets}
      target={target}
    />
  );
}

function generate() {
  fireEvent.click(screen.getByRole("button", { name: /^generate/ }));
}

describe("an honest generation plan", () => {
  it("does not mention lettering until an approved headline is selected", () => {
    render(
      <Harness
        catalog={LETTERING_CATALOG}
        initial={{ settings: SETTINGS }}
        generationProjectId="project-a"
        onGenerate={vi.fn()}
      />,
    );
    expect(screen.queryByText("letteringIdeogramHint")).toBeNull();
    expect(screen.queryByText("letteringFallbackHint")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "letteringIdeogram" }),
    ).toBeNull();
  });

  it("defaults approved headlines to two-step Ideogram lettering with both charges", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={LETTERING_CATALOG}
        generationProjectId="project-a"
        initial={{
          settings: { ...SETTINGS, resolution: "2K" },
          exportHeadlines: { projectId: "project-a", lines: ["Made to last"] },
        }}
        onGenerate={onGenerate}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "letteringOverlay" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "letteringIdeogram" }),
    ).toBeNull();
    expect(screen.getByText("letteringIdeogramHint")).toBeInTheDocument();
    expect(
      screen.getByText(
        'letteringPlanCredits:{"sceneCredits":15,"letteringCredits":3,"credits":18}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('creditsEach:{"credits":15,"count":1}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('creditsEach:{"credits":3,"count":1}'),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2K" })).toBeNull();
    generate();
    expect(onGenerate.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        modelId: "gemini-pro",
        lettering: "ideogram",
        exportHeadline: "Made to last",
        settings: { ...SETTINGS, resolution: "1K" },
      }),
    ]);
  });

  it("reprices both lettering legs from the catalog for every requested copy", () => {
    const catalog = {
      ...LETTERING_CATALOG,
      models: LETTERING_CATALOG.models.map((model) =>
        model.id === "ideogram-v3"
          ? {
              ...model,
              price: {
                ...model.price,
                unitPriceUsd: 0.06,
                perImageUsd: { "1K": 0.06 },
              },
            }
          : model,
      ),
    };
    render(
      <Harness
        catalog={catalog}
        generationProjectId="project-a"
        initial={{
          settings: SETTINGS,
          exportHeadlines: { projectId: "project-a", lines: ["Made to last"] },
        }}
        onGenerate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(
      screen.getByText(
        'letteringPlanCredits:{"sceneCredits":30,"letteringCredits":12,"credits":42}',
      ),
    ).toBeInTheDocument();
  });

  it("falls back to the exact-font overlay when Ideogram cannot letter", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    const catalog = {
      ...LETTERING_CATALOG,
      models: LETTERING_CATALOG.models.filter(
        (model) => model.id !== "ideogram-v3",
      ),
    };
    render(
      <Harness
        catalog={catalog}
        generationProjectId="project-a"
        initial={{
          settings: SETTINGS,
          exportHeadlines: { projectId: "project-a", lines: ["Made to last"] },
        }}
        onGenerate={onGenerate}
      />,
    );
    expect(screen.getByText("letteringFallbackHint")).toBeInTheDocument();
    generate();
    expect(onGenerate.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        modelId: "gemini-pro",
        exportHeadline: "Made to last",
        lettering: "overlay",
      }),
    ]);
  });

  it("recovers a failed Ideogram edit with one catalog charge and its existing backdrop", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    const backdrop: StudioAsset = {
      id: "backdrop",
      projectId: "project-a",
      projectName: "Ad",
      rootId: "backdrop",
      parentId: null,
      version: 1,
      prompt: "A product",
      model: "gemini-pro",
      settings: SETTINGS,
      width: 1024,
      height: 1024,
      bytes: 3,
      contentType: "image/png",
      mediaType: "IMAGE",
      video: null,
      createdAt: new Date(),
      jobId: "scene-job",
      contentPath: "/backdrop",
      lettering: "ideogram",
      myThumb: null,
      myReasons: [],
      myComment: null,
      thumbsUp: 0,
      thumbsDown: 0,
      score: 0.5,
    };
    const props = {
      catalog: LETTERING_CATALOG,
      generationProjectId: "project-a",
      initial: {
        settings: SETTINGS,
        letteringBackdropId: backdrop.id,
        exportHeadlines: { projectId: "project-a", lines: ["Made to last"] },
      },
      onGenerate,
    };
    const view = render(<Harness {...props} referenceAssets={[backdrop]} />);
    expect(
      screen.getByText('placementPlanCredits:{"count":1,"credits":3}'),
    ).toBeInTheDocument();
    expect(screen.getByText("letteringEditHint")).toBeInTheDocument();
    expect(screen.queryByText("letteringIdeogramHint")).toBeNull();
    generate();
    expect(onGenerate.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        modelId: "ideogram-v3",
        letterExistingBackdrop: true,
        lettering: "ideogram",
        exportHeadline: "Made to last",
        parentAssetId: "backdrop",
        referenceAssetIds: ["backdrop"],
      }),
    ]);
    view.rerender(
      <Harness
        {...props}
        referenceAssets={[{ ...backdrop, id: "other-image" }]}
      />,
    );
    expect(
      screen.getByText(
        'letteringPlanCredits:{"sceneCredits":15,"letteringCredits":3,"credits":18}',
      ),
    ).toBeInTheDocument();
    generate();
    const changedSource = onGenerate.mock.calls[1][0][0];
    expect(changedSource.modelId).toBe("gemini-pro");
    expect(changedSource.letterExistingBackdrop).toBeUndefined();
  });

  it("uses each product's original cutout and blocks a batch with a missing photo", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    const props = {
      catalog: TEST_CATALOG,
      initial: { settings: SETTINGS },
      onGenerate,
    };
    const view = render(<Harness {...props} batchProducts={BATCH_PRODUCTS} />);
    const toggle = screen.getByRole("button", { name: "useProductCutout" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    generate();
    expect(
      onGenerate.mock.calls[0][0].map(
        ({ useProductCutout, referenceFileIds }) => ({
          useProductCutout,
          referenceFileIds,
        }),
      ),
    ).toEqual([
      { useProductCutout: true, referenceFileIds: ["vase-file"] },
      { useProductCutout: true, referenceFileIds: ["vase-file"] },
      { useProductCutout: true, referenceFileIds: ["mug-file"] },
    ]);

    view.rerender(
      <Harness
        {...props}
        batchProducts={[
          BATCH_PRODUCTS[0],
          { ...BATCH_PRODUCTS[1], photo: null },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /^generate/ })).toBeDisabled();
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("cycles approved headlines by variation and keeps the same wording across sizes", async () => {
    getBrandKit.mockResolvedValueOnce({
      approvedLines: ["First claim", "Second claim"],
    });
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    const input = {
      catalog: TEST_CATALOG,
      initial: {
        settings: SETTINGS,
        placementRatios: ["1:1", "9:16"] as StudioTarget["placementRatios"],
      },
      batchProducts: BATCH_PRODUCTS,
      onGenerate,
    };
    const { rerender } = render(
      <Harness {...input} generationProjectId="first-project" />,
    );
    const toggle = screen.getByRole("button", { name: "useApprovedHeadlines" });
    await act(async () => fireEvent.click(toggle));
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(getBrandKit).toHaveBeenCalledWith({ projectId: "first-project" });
    generate();
    expect(
      onGenerate.mock.calls[0][0].map(({ exportHeadline, settings }) => [
        exportHeadline,
        settings.aspectRatio,
      ]),
    ).toEqual([
      ["First claim", "1:1"],
      ["First claim", "9:16"],
      ["Second claim", "1:1"],
      ["Second claim", "9:16"],
      ["First claim", "1:1"],
      ["First claim", "9:16"],
    ]);

    rerender(<Harness {...input} generationProjectId="other-project" />);
    generate();
    expect(
      onGenerate.mock.calls[1][0].every(
        ({ exportHeadline }) => !exportHeadline,
      ),
    ).toBe(true);
  });

  it("uses the selected creative direction without changing the written brief", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ settings: SETTINGS }}
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
        initial={{ settings: SETTINGS }}
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
    expect(requests.map(({ variationIndex }) => variationIndex)).toEqual([
      0,
      0,
      1,
      1,
      undefined,
      undefined,
    ]);
    expect(
      new Set(requests.map(({ creativeDirection }) => creativeDirection)),
    ).toEqual(new Set(["explainer"]));
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
          settings: { ...SETTINGS, seed: 42 },
        }}
        onGenerate={onGenerate}
      />,
    );
    generate();
    const requests = onGenerate.mock.calls[0][0];
    expect(new Set(requests.map(({ prompt }) => prompt)).size).toBe(MAX_BATCH);
    expect(requests.map(({ variationIndex }) => variationIndex)).toEqual(
      Array.from({ length: MAX_BATCH }, (_, index) => index),
    );
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
        initial={{ settings: SETTINGS }}
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
    expect(
      onGenerate.mock.calls[0][0].map((request) => request.variationIndex),
    ).toEqual([undefined, undefined]);
  });

  it("recognizes variation and direction metadata when a prompt is reused for one copy", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ settings: SETTINGS }}
        onGenerate={onGenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    fireEvent.click(
      screen.getByRole("button", { name: "CreativeDirections.editorial" }),
    );
    generate();
    const reusedPrompt = onGenerate.mock.calls[0][0][1].prompt;
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(
      screen.getByRole("button", { name: "CreativeDirections.auto" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: TEST_LABELS.promptPlaceholder }),
      { target: { value: reusedPrompt } },
    );
    generate();

    expect(onGenerate.mock.calls[1][0][0]).toMatchObject({
      prompt: reusedPrompt,
      variationIndex: 1,
      creativeDirection: "editorial",
    });
  });

  it("prices and submits the requested placements within the copy limit", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={TEST_CATALOG}
        initial={{ settings: SETTINGS }}
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

  it("blocks an oversized product batch until fewer placements are requested", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        batchProducts={[{ ...BATCH_PRODUCTS[0], copies: MAX_BATCH }]}
        initial={{ settings: SETTINGS, placementRatios: ["1:1", "9:16"] }}
        onGenerate={onGenerate}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      'productBatchLimit:{"count":12}',
    );
    expect(screen.getByRole("button", { name: /^generate/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Placements.stories/ }));
    generate();
    expect(onGenerate.mock.calls[0][0]).toHaveLength(MAX_BATCH);
  });

  it("keeps an unsupported placement visible so it can be removed", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={{ ...TEST_CATALOG, defaultModelId: "model-b" }}
        initial={{ settings: SETTINGS, placementRatios: ["9:16"] }}
        onGenerate={onGenerate}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "unsupportedPlacements",
    );
    expect(screen.getByRole("button", { name: /^generate/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Placements.stories/ }));
    generate();
    expect(onGenerate.mock.calls[0][0]).toHaveLength(1);
  });

  it("summarizes a single model's normalized frame instead of inherited settings", () => {
    const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
    render(
      <Harness
        catalog={{ ...TEST_CATALOG, defaultModelId: "model-b" }}
        initial={{
          settings: { ...SETTINGS, aspectRatio: "9:16", resolution: "0.5K" },
        }}
        onGenerate={onGenerate}
      />,
    );

    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();
    expect(screen.queryByText("9:16 · 0.5K · png")).not.toBeInTheDocument();
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
    "discloses the format the automatic model uses for $shownFormat",
    ({ outputFormats, actualFormat, shownFormat }) => {
      const onGenerate = vi.fn<(requests: GenerationRequest[]) => void>();
      const catalog = {
        ...TEST_CATALOG,
        models: [{ ...TEST_CATALOG.models[0], outputFormats }],
      };
      render(
        <Harness
          catalog={catalog}
          initial={{ settings: { ...SETTINGS, outputFormat: "webp" } }}
          onGenerate={onGenerate}
        />,
      );
      expect(
        screen.getByText(`dimensions: 1:1 · 1K · ${shownFormat}`),
      ).toBeInTheDocument();
      generate();
      expect(onGenerate.mock.calls[0][0][0].settings.outputFormat).toBe(
        actualFormat,
      );
    },
  );
});
