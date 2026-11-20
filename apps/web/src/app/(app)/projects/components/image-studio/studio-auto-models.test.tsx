import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { StudioComposer } from "./studio-composer";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type { StudioTarget } from "./types";
import type { GenerationRequest } from "./use-generation-queue";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("./studio-headline-kit", () => ({
  readStudioHeadlineKit: vi.fn(),
}));

const catalog = {
  ...TEST_CATALOG,
  defaultModelId: "gemini-pro",
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
  it("submits Gemini Pro without showing a model picker", () => {
    const onGenerate = vi.fn();
    render(<Harness onGenerate={onGenerate} />);
    expect(
      screen.queryByRole("button", { name: "advanced" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "generateOne" }));
    expect(onGenerate).toHaveBeenCalledWith([
      expect.objectContaining({ modelId: "gemini-pro" }),
    ]);
  });
});
