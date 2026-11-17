import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { StudioComposer } from "./studio-composer";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import {
  StudioVideoComposer,
  type StudioVideoDraft,
  videoDraftFor,
} from "./studio-video-composer";
import type { StudioTarget } from "./types";
import type { GenerationRequest } from "./use-generation-queue";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("./studio-approved-headlines", () => ({
  readApprovedStudioHeadlines: vi.fn(),
}));

const catalog = {
  ...TEST_CATALOG,
  models: [
    ...TEST_CATALOG.models,
    { ...TEST_CATALOG.models[0], id: "gemini-pro", label: "Gemini Pro" },
  ],
};

function Harness({
  onGenerate,
}: {
  onGenerate: (requests: GenerationRequest[]) => void;
}) {
  const [target, setTarget] = useState<StudioTarget>({
    modelIds: [],
    modelSelection: "auto",
    settings: { aspectRatio: "1:1", resolution: "1K", outputFormat: "png" },
  });
  return (
    <StudioComposer
      busy={false}
      catalog={catalog}
      labels={TEST_LABELS}
      onApplyTemplate={vi.fn()}
      onClearReferences={vi.fn()}
      onGenerate={onGenerate}
      onPromptChange={vi.fn()}
      onTargetChange={setTarget}
      prompt="An imaginary product on a plain background"
      referenceAssets={[]}
      target={target}
    />
  );
}

describe("automatic model selection in the composer", () => {
  it("hides the full model picker until Advanced is opened", () => {
    render(<Harness onGenerate={vi.fn()} />);
    const advanced = screen.getByRole("button", { name: "advanced" });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Gemini Pro")).not.toBeInTheDocument();
    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("checkbox")).toHaveLength(catalog.models.length);
    expect(screen.getByRole("button", { name: "autoModel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("sends the chosen model, and returning to Auto sends Gemini Pro", () => {
    const onGenerate = vi.fn();
    render(<Harness onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "generateOne" }));
    expect(onGenerate.mock.calls[0]![0][0].modelId).toBe("gemini-pro");
    fireEvent.click(screen.getByRole("button", { name: "advanced" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Model B/ }));
    fireEvent.click(screen.getByRole("button", { name: "generateOne" }));
    expect(onGenerate.mock.calls[1]![0][0].modelId).toBe("model-b");
    fireEvent.click(screen.getByRole("button", { name: "autoModel" }));
    fireEvent.click(screen.getByRole("button", { name: "generateOne" }));
    expect(onGenerate.mock.calls[2]![0][0].modelId).toBe("gemini-pro");
  });
});

const videoCatalog = {
  ...catalog,
  videoModels: [
    ...catalog.videoModels,
    { ...catalog.videoModels[0]!, id: "h3-max", label: "H3 Max" },
  ],
};

function VideoHarness({
  onGenerate,
}: {
  onGenerate: (draft: StudioVideoDraft) => void;
}) {
  const [draft, setDraft] = useState<StudioVideoDraft>({
    ...videoDraftFor(videoCatalog.videoModels.at(-1)!),
    modelSelection: "auto",
  });
  return (
    <StudioVideoComposer
      busy={false}
      canGenerate
      catalog={videoCatalog}
      draft={draft}
      labels={TEST_LABELS}
      modeSwitch={null}
      onClearSource={vi.fn()}
      onDraftChange={setDraft}
      onGenerate={() => onGenerate(draft)}
      onPromptChange={vi.fn()}
      prompt="An imaginary product rotating slowly"
      promptRef={createRef()}
      source={null}
    />
  );
}

describe("automatic video model selection", () => {
  it("keeps the picker in Advanced and restores H3 Max through Auto", () => {
    const onGenerate = vi.fn();
    render(<VideoHarness onGenerate={onGenerate} />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "generateVideo" }));
    expect(onGenerate.mock.calls[0]![0].modelId).toBe("h3-max");
    fireEvent.click(screen.getByRole("button", { name: "advanced" }));
    fireEvent.click(screen.getByRole("radio", { name: /Video A/ }));
    fireEvent.click(screen.getByRole("button", { name: "generateVideo" }));
    expect(onGenerate.mock.calls[1]![0]).toMatchObject({
      modelId: TEST_CATALOG.videoModels[0]!.id,
    });
    expect(onGenerate.mock.calls[1]![0].modelSelection).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "autoModel" }));
    fireEvent.click(screen.getByRole("button", { name: "generateVideo" }));
    expect(onGenerate.mock.calls[2]![0]).toMatchObject({
      modelId: "h3-max",
      modelSelection: "auto",
    });
  });
});
