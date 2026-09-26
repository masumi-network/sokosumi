import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { StudioComposer } from "./studio-composer";
import { TEST_CATALOG } from "./studio-fixtures";
import type { StudioLabels, StudioTarget } from "./types";
import type { QueuedGeneration } from "./use-generation-queue";

/**
 * The composer, driven the way a person drives it.
 *
 * The rule under test: a model that cannot frame the chosen placement must
 * not survive in the selection, and must never reach a request. Asserting
 * only that the fixture *has* such a model proves nothing about the
 * composer — this drives the actual chips.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const LABELS = new Proxy(
  {},
  { get: (_t, k) => String(k) },
) as unknown as StudioLabels;

/** Holds the target the way the studio shell does, so chips really toggle. */
function Harness({
  initial,
  onGenerate,
}: {
  initial: StudioTarget;
  onGenerate: (requests: QueuedGeneration[]) => void;
}) {
  const [target, setTarget] = useState<StudioTarget>(initial);
  return (
    <>
      <StudioComposer
        busy={false}
        catalog={TEST_CATALOG}
        labels={LABELS}
        onClearReferences={() => {}}
        onGenerate={onGenerate}
        onTargetChange={(update) => setTarget((current) => update(current))}
        projectId="p"
        referenceAssets={[]}
        target={target}
      />
      <output data-testid="models">{target.modelIds.join(",")}</output>
      <output data-testid="placement">{target.placementId ?? "none"}</output>
      <output data-testid="frame">{target.settings.aspectRatio ?? "-"}</output>
    </>
  );
}

const BOTH_MODELS: StudioTarget = {
  // model-b cannot frame 9:16; model-a can. See TEST_CATALOG.
  modelIds: ["model-a", "model-b"],
  placementId: null,
  settings: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
    placementId: null,
  },
};

function clickChip(text: string) {
  const chip = screen
    .getAllByRole("button")
    .find((b) => b.textContent?.replace(/\s+/g, " ").trim().includes(text));
  if (!chip) throw new Error(`no chip containing ${text}`);
  fireEvent.click(chip);
}

describe("choosing a placement some selected models cannot frame", () => {
  it("drops the model that cannot frame it", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);
    expect(screen.getByTestId("models").textContent).toBe("model-a,model-b");

    clickChip("Instagram Reels");

    // model-b has no 9:16, so it cannot serve this placement and must go.
    expect(screen.getByTestId("models").textContent).toBe("model-a");
    expect(screen.getByTestId("placement").textContent).toBe("reels");
    expect(screen.getByTestId("frame").textContent).toBe("9:16");
  });

  it("never builds a request for a model that cannot frame it", () => {
    const onGenerate = vi.fn();
    render(<Harness initial={BOTH_MODELS} onGenerate={onGenerate} />);

    clickChip("Instagram Reels");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a vertical product shot" },
    });
    clickChip("generateOne");

    expect(onGenerate).toHaveBeenCalledTimes(1);
    const requests = onGenerate.mock.calls[0][0] as QueuedGeneration[];
    expect(requests.map((r) => r.modelId)).toEqual(["model-a"]);
    // The frame that goes out is the placement's, not a clamped substitute.
    expect(requests[0].settings.aspectRatio).toBe("9:16");
    expect(requests[0].settings.placementId).toBe("reels");
  });

  it("switches to a model that can frame it when none of the selected can", () => {
    render(
      <Harness
        initial={{ ...BOTH_MODELS, modelIds: ["model-b"] }}
        onGenerate={vi.fn()}
      />,
    );

    clickChip("Instagram Reels");

    // Refusing silently would make the chip look broken; the composer picks
    // the first catalog model that can serve it instead.
    expect(screen.getByTestId("models").textContent).toBe("model-a");
    expect(screen.getByTestId("placement").textContent).toBe("reels");
  });

  it("leaves the selection alone when the placement is cleared", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);
    clickChip("Instagram Reels");
    expect(screen.getByTestId("models").textContent).toBe("model-a");

    clickChip("placementNone");

    expect(screen.getByTestId("placement").textContent).toBe("none");
    // Clearing a placement is not a request to reframe or to re-add models.
    expect(screen.getByTestId("frame").textContent).toBe("9:16");
    expect(screen.getByTestId("models").textContent).toBe("model-a");
  });
});
