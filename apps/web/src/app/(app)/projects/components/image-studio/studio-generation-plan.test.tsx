import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { MAX_BATCH, StudioComposer } from "./studio-composer";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type { StudioCatalog, StudioTarget } from "./types";
import type { GenerationRequest } from "./use-generation-queue";

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

function Harness({
  catalog = LARGE_CATALOG,
  initial,
  onGenerate,
}: {
  catalog?: StudioCatalog;
  initial: StudioTarget;
  onGenerate: (requests: GenerationRequest[]) => void;
}) {
  const [target, setTarget] = useState(initial);
  const [prompt, setPrompt] = useState("A campaign image");
  return (
    <StudioComposer
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
      onPromptChange={setPrompt}
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
    const catalog: StudioCatalog = {
      ...TEST_CATALOG,
      models: TEST_CATALOG.models.map((model) =>
        model.id === "model-a"
          ? { ...model, aspectRatios: [...model.aspectRatios, "2:3"] }
          : model,
      ),
    };
    render(
      <Harness
        catalog={catalog}
        initial={{ modelIds: ["model-a", "model-b"], settings: SETTINGS }}
        onGenerate={onGenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "poster" }));
    expect(screen.getByText("mixedSettings")).toBeInTheDocument();
    expect(screen.getAllByText("dimensions: 2:3 · 1K · png")).toHaveLength(2);
    expect(screen.getAllByText("dimensions: 1:1 · 1K · png")).toHaveLength(2);
    generate();
    expect(
      onGenerate.mock.calls[0][0].map(
        (request) => request.settings.aspectRatio,
      ),
    ).toEqual(["2:3", "1:1"]);
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
