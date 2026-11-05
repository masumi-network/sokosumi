import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { StudioComposer } from "./studio-composer";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type { StudioTarget } from "./types";
import type { GenerationRequest } from "./use-generation-queue";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

function Harness({
  onGenerate,
}: {
  onGenerate: (requests: GenerationRequest[]) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState<StudioTarget>({
    modelIds: ["model-a"],
    settings: {
      aspectRatio: "1:1",
      resolution: "1K",
      outputFormat: "png",
      seed: null,
    },
  });
  return (
    <StudioComposer
      busy={false}
      catalog={TEST_CATALOG}
      labels={TEST_LABELS}
      onApplyTemplate={vi.fn()}
      onClearReferences={vi.fn()}
      onGenerate={onGenerate}
      onPromptChange={setPrompt}
      onTargetChange={setTarget}
      prompt={prompt}
      referenceAssets={[]}
      showTemplates={false}
      target={target}
    />
  );
}

function promptBox() {
  return screen.getByRole("textbox", { name: "promptPlaceholder" });
}

describe("a paid prompt submission", () => {
  it("inserts new lines with Enter and Shift+Enter without buying images", async () => {
    const onGenerate = vi.fn();
    const user = userEvent.setup();
    render(<Harness onGenerate={onGenerate} />);
    await user.click(promptBox());
    await user.type(
      promptBox(),
      "First line{Enter}Second line{Shift>}{Enter}{/Shift}Third line",
    );
    expect(promptBox()).toHaveValue("First line\nSecond line\nThird line");
    expect(onGenerate).not.toHaveBeenCalled();
    expect(promptBox()).toHaveAccessibleDescription(/promptShortcut/);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])(
    "ignores a held shortcut (%j)",
    (modifier) => {
      const onGenerate = vi.fn();
      render(<Harness onGenerate={onGenerate} />);
      fireEvent.change(promptBox(), { target: { value: "A campaign image" } });
      fireEvent.keyDown(promptBox(), {
        key: "Enter",
        repeat: true,
        ...modifier,
      });
      expect(onGenerate).not.toHaveBeenCalled();
      expect(promptBox()).toHaveValue("A campaign image");
    },
  );

  it.each([
    { metaKey: true, shiftKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, altKey: true },
    { ctrlKey: true, altKey: true },
  ])("ignores a modified submission shortcut (%j)", (modifier) => {
    const onGenerate = vi.fn();
    render(<Harness onGenerate={onGenerate} />);
    fireEvent.change(promptBox(), { target: { value: "A campaign image" } });
    fireEvent.keyDown(promptBox(), { key: "Enter", ...modifier });
    expect(onGenerate).not.toHaveBeenCalled();
  });
});
