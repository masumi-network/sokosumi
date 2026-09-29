import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { MAX_BATCH, StudioComposer } from "./studio-composer";
import { TEST_CATALOG } from "./studio-fixtures";
import type { StudioCatalog, StudioLabels, StudioTarget } from "./types";
import type { GenerationRequest } from "./use-generation-queue";

/**
 * The composer, driven the way a person drives it.
 *
 * The rules under test are the ones about what a press of Generate buys: which
 * models it runs, how many copies of each, what that is worth, and how the
 * batch ceiling cuts a plan down. Asserting on the fixture proves nothing
 * about the composer — this drives the actual controls.
 *
 * Radix's menu and popover are stubbed, as they are elsewhere in this app's
 * suite: they open on a real pointer event that happy-dom does not produce,
 * and what is under test is the composer's rules, not Radix's. The stubs
 * render their content inline, so every option is reachable by its text.
 */

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

const LABELS = new Proxy(
  {},
  { get: (_t, k) => String(k) },
) as unknown as StudioLabels;

/**
 * A catalog with `count` interchangeable models.
 *
 * For the batch ceiling only. The real catalog has three models, so nothing in
 * it can reach the ceiling — and a limit that is never exercised is a limit
 * nobody knows is broken.
 */
function catalogOf(count: number): StudioCatalog {
  const template = TEST_CATALOG.models[0];
  return {
    ...TEST_CATALOG,
    defaultModelId: "many-0",
    models: Array.from({ length: count }, (_unused, index) => ({
      ...template,
      id: `many-${index}`,
      label: `Many ${index}`,
    })),
  };
}

function targetFor(modelIds: string[]): StudioTarget {
  return {
    modelIds,
    settings: {
      aspectRatio: "1:1",
      resolution: "1K",
      outputFormat: "png",
      seed: null,
    },
  };
}

/** Holds the state the studio shell holds, so the controls really work. */
function Harness({
  catalog = TEST_CATALOG,
  initial,
  onGenerate,
}: {
  catalog?: StudioCatalog;
  initial: StudioTarget;
  onGenerate: (requests: GenerationRequest[]) => void;
}) {
  const [target, setTarget] = useState<StudioTarget>(initial);
  const [prompt, setPrompt] = useState("");
  return (
    <>
      <StudioComposer
        busy={false}
        catalog={catalog}
        labels={LABELS}
        onApplyTemplate={() => {}}
        onClearReferences={() => {}}
        onGenerate={onGenerate}
        onPromptChange={setPrompt}
        onTargetChange={(update) => setTarget((current) => update(current))}
        prompt={prompt}
        referenceAssets={[]}
        target={target}
      />
      <output data-testid="models">{target.modelIds.join(",")}</output>
      <output data-testid="frame">{target.settings.aspectRatio ?? "-"}</output>
    </>
  );
}

const BOTH_MODELS: StudioTarget = targetFor(["model-a", "model-b"]);

/**
 * Click the control whose visible text says `text`.
 *
 * By element rather than by role: the stubbed menu items carry
 * `menuitemcheckbox`, which replaces the implicit button role, so a role query
 * would miss exactly the options under test.
 */
function clickOption(text: string) {
  const option = [...document.querySelectorAll("button")].find((element) =>
    element.textContent?.replace(/\s+/g, " ").trim().includes(text),
  );
  if (!option) throw new Error(`no option containing ${text}`);
  fireEvent.click(option);
}

/**
 * Click the control whose visible text is exactly `text`.
 *
 * The chips are single characters and short tokens — "4", "2K" — and a
 * substring match on those hits the ratios and the resolutions too.
 */
function clickChip(text: string) {
  const chip = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.replace(/\s+/g, " ").trim() === text,
  );
  if (!chip) throw new Error(`no chip reading exactly ${text}`);
  fireEvent.click(chip);
}

/**
 * Toggle one model's menu entry.
 *
 * By role, not by text: the trigger summarises the selection, so when one model
 * is left it *also* reads "Model B" — and it comes first in the DOM, so a
 * text-first search clicks the trigger and silently does nothing.
 */
function clickModel(label: string) {
  const entry = screen
    .getAllByRole("checkbox")
    .find((node) => node.textContent?.includes(label));
  if (!entry) throw new Error(`no model entry for ${label}`);
  fireEvent.click(entry);
}

function generate(prompt = "a calm product shot") {
  fireEvent.change(screen.getByRole("textbox", { name: "promptPlaceholder" }), {
    target: { value: prompt },
  });
  // By name rather than by an exact label: the button says "generateOne" for a
  // single image and "generateMany" with a count for a batch, which is the
  // whole point of it.
  fireEvent.click(screen.getByRole("button", { name: /^generate/i }));
}

describe("choosing between 152 models", () => {
  it("prices every row, so the choice is not guesswork", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    const rows = screen.getAllByRole("checkbox");
    // Model A is 4 credits an image at 1K and Model B is 10. Before this the
    // only figure anywhere was the aggregate after selection.
    expect(rows[0]).toHaveTextContent('creditsCount:{"count":4}');
    expect(rows[1]).toHaveTextContent('creditsCount:{"count":10}');
  });

  it("follows the frame, because the frame is what decides it", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    clickChip("2K");

    // Model A has a verified 2K figure; Model B falls through to its megapixel
    // unit price at 2048x2048. A row showing the 1K price at 2K would be the
    // picker disagreeing with the button.
    const rows = screen.getAllByRole("checkbox");
    expect(rows[0]).toHaveTextContent('creditsCount:{"count":8}');
    expect(rows[1]).toHaveTextContent('creditsCount:{"count":21}');
  });

  it("says so rather than nothing when a model cannot be priced", () => {
    const unpriceable: StudioCatalog = {
      ...TEST_CATALOG,
      defaultModelId: "by-the-second",
      models: [
        {
          ...TEST_CATALOG.models[0],
          id: "by-the-second",
          label: "By the second",
          price: {
            unit: "compute seconds",
            unitPriceUsd: 0.002,
            basis: "Priced by how long it runs.",
            sourceUrl: "https://example.test/by-the-second",
            verifiedAt: "2026-09-27",
          },
        },
      ],
    };

    render(
      <Harness
        catalog={unpriceable}
        initial={targetFor(["by-the-second"])}
        onGenerate={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("checkbox")[0]).toHaveTextContent(
      "creditsNoFigure",
    );
  });
});

describe("what the composer says without being opened", () => {
  it("names the single chosen model", () => {
    render(
      <Harness
        initial={{ ...BOTH_MODELS, modelIds: ["model-a"] }}
        onGenerate={vi.fn()}
      />,
    );
    // The trigger is the summary: choosing a model must be legible without
    // opening the menu that chose it.
    expect(screen.getAllByText("Model A").length).toBeGreaterThan(0);
  });

  it("counts them once there are several", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);
    expect(screen.getByText('modelCount:{"count":2}')).toBeInTheDocument();
  });

  it("summarises the frame, resolution and format", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);
    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();
  });
});

/**
 * What the composer promises before the credits are spent.
 *
 * Not an estimate any more: `creditsPerImageCents` is the function Core charges
 * with, over the same catalog row, so this line is the debit. Which makes it
 * worth pinning to the arithmetic rather than to a shape — a number that
 * disagrees with the ledger is the one bug this whole seam exists to prevent.
 */
describe("the line above Generate", () => {
  it("says how many runs, across how many models, and how many credits", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    // Model A publishes $0.04 an image at 1K and Model B $0.10, so 4 + 10
    // credits at 1 credit to the cent. See TEST_CATALOG.
    expect(
      screen.getByText('runPlanCredits:{"copies":1,"models":2,"credits":14}'),
    ).toBeInTheDocument();
  });

  it("multiplies by the runs asked for", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    clickChip("3");

    // Three runs each of a 4-credit and a 10-credit model.
    expect(
      screen.getByText('runPlanCredits:{"copies":3,"models":2,"credits":42}'),
    ).toBeInTheDocument();
  });

  it("prices a per-megapixel model off the frame it would run at", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    clickChip("2K");

    // Model A has a hand-verified $0.08 at 2K → 8 credits. Model B has no 2K
    // figure, so its megapixel unit price decides: $0.05 x 4.19MP at 2048x2048
    // → 21 credits. Taking the wrong branch for either one is how the composer
    // and the ledger start disagreeing.
    expect(
      screen.getByText('runPlanCredits:{"copies":1,"models":2,"credits":29}'),
    ).toBeInTheDocument();
  });

  it("stays silent about credits rather than printing NaN", () => {
    // Core excludes models it cannot price per image, so this should never
    // reach the composer — but "should never" is not "cannot", and a batch
    // total of `NaN` credits is the worst possible thing to show about money.
    const unpriceable: StudioCatalog = {
      ...TEST_CATALOG,
      defaultModelId: "by-the-second",
      models: [
        {
          ...TEST_CATALOG.models[0],
          id: "by-the-second",
          label: "By the second",
          price: {
            unit: "compute seconds",
            unitPriceUsd: 0.002,
            basis: "Priced by how long it runs, which nobody knows yet.",
            sourceUrl: "https://example.test/by-the-second",
            verifiedAt: "2026-09-27",
          },
        },
      ],
    };

    render(
      <Harness
        catalog={unpriceable}
        initial={targetFor(["by-the-second"])}
        onGenerate={vi.fn()}
      />,
    );

    expect(
      screen.getByText('runPlan:{"copies":1,"models":1}'),
    ).toBeInTheDocument();
    expect(screen.getByText("creditsUnderivable")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("buys exactly the batch it described", () => {
    const onGenerate = vi.fn();
    render(<Harness initial={BOTH_MODELS} onGenerate={onGenerate} />);

    clickChip("3");
    generate();

    const requests = onGenerate.mock.calls[0][0] as GenerationRequest[];
    expect(requests).toHaveLength(6);
    // Round-robin: the first pass covers every model, so a batch is comparable
    // while it is still arriving.
    expect(requests.slice(0, 2).map((request) => request.modelId)).toEqual([
      "model-a",
      "model-b",
    ]);
  });
});

describe("a copy count the ceiling rules out", () => {
  /** The chips, by their visible number. */
  function copyChip(count: string) {
    const chip = [...document.querySelectorAll("button")].find(
      (node) => node.textContent?.trim().startsWith(count) && node.title,
    );
    return chip ?? null;
  }

  it("says why, in its own arithmetic", () => {
    // Five interchangeable models: 5x3 and 5x4 are over the twelve-image cap.
    render(
      <Harness
        catalog={catalogOf(5)}
        initial={targetFor(["many-0", "many-1", "many-2", "many-3", "many-4"])}
        onGenerate={vi.fn()}
      />,
    );

    const three = copyChip("3");
    expect(three).not.toBeNull();
    // The multiplication, not a pointer at a footnote. A dimmed "3" beside
    // "at most 12 images per press" left the reader to do this themselves.
    const reason =
      'copiesOverCeiling:{"models":5,"copies":3,"images":15,"limit":12}';
    expect(three?.title).toBe(reason);
    expect(three?.textContent).toContain(reason);
  });

  it("stays focusable, so the reason can be read out", () => {
    render(
      <Harness
        catalog={catalogOf(5)}
        initial={targetFor(["many-0", "many-1", "many-2", "many-3", "many-4"])}
        onGenerate={vi.fn()}
      />,
    );

    const three = copyChip("3");
    // `aria-disabled`, not `disabled`: a natively disabled control is not
    // focusable, so a screen reader could never reach the description. It heard
    // "3, dimmed" and nothing else.
    expect(three?.getAttribute("aria-disabled")).toBe("true");
    expect(three?.hasAttribute("disabled")).toBe(false);
    expect(three?.getAttribute("aria-describedby")).toBe(
      "studio-copies-3-reason",
    );
    expect(document.getElementById("studio-copies-3-reason")).not.toBeNull();
  });

  it("still refuses the press", () => {
    render(
      <Harness
        catalog={catalogOf(5)}
        initial={targetFor(["many-0", "many-1", "many-2", "many-3", "many-4"])}
        onGenerate={vi.fn()}
      />,
    );

    const before = screen.getByText(/^runPlanCredits/).textContent;
    const three = copyChip("3");
    if (three) fireEvent.click(three);

    // The cap is unchanged; only the explaining is new.
    expect(screen.getByText(/^runPlanCredits/).textContent).toBe(before);
  });

  it("says nothing on a count that is available", () => {
    render(<Harness initial={targetFor(["model-a"])} onGenerate={vi.fn()} />);

    // One model, so every count fits and no chip needs a reason.
    const withReason = [...document.querySelectorAll("button")].filter(
      (node) => node.title,
    );
    expect(withReason).toHaveLength(0);
  });
});

describe("how a price is explained", () => {
  it("says the unit once, in the singular", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    // fal's pricing API answers in plurals because it is describing a rate, and
    // Core passes that through in `price.basis` — so the sentence used to read
    // "fal lists $0.04 per images for this endpoint". Model A is priced per
    // image and Model B per megapixel, so both branches show up here.
    expect(
      screen.getByText(
        'priceBasis:{"price":"$0.04","unit":"PriceUnits.images"}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'priceBasis:{"price":"$0.05","unit":"PriceUnits.megapixels"}',
      ),
    ).toBeInTheDocument();
    // And never Core's own English sentence.
    expect(screen.queryByText(/per images/)).toBeNull();
  });

  it("falls back to fal's own word for a unit we have no name for", () => {
    const perSecond: StudioCatalog = {
      ...TEST_CATALOG,
      defaultModelId: "by-the-second",
      models: [
        {
          ...TEST_CATALOG.models[0],
          id: "by-the-second",
          label: "By the second",
          price: {
            unit: "compute seconds",
            unitPriceUsd: 0.002,
            basis: "Priced by how long it runs.",
            sourceUrl: "https://example.test/by-the-second",
            verifiedAt: "2026-09-27",
          },
        },
      ],
    };

    render(
      <Harness
        catalog={perSecond}
        initial={targetFor(["by-the-second"])}
        onGenerate={vi.fn()}
      />,
    );

    // A real unit that sounds slightly off beats a confidently invented
    // singular. These never reach the catalog anyway — Core excludes them.
    expect(
      screen.getByText(
        'priceBasis:{"price":"$0.002","unit":"compute seconds"}',
      ),
    ).toBeInTheDocument();
  });
});

describe("unselecting a model", () => {
  it("leaves the frame where it was", () => {
    // A property rather than a regression: unselecting narrows nothing, so it
    // has no business touching the frame. `toggleModel` only clamps on the way
    // in for that reason. (The clamp on the way out was a no-op — every
    // selected model already supports the current frame — so this pins the
    // property, it does not commemorate a bug.)
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    clickModel("Model B");
    expect(screen.getByTestId("models").textContent).toBe("model-a");
    clickChip("9:16");
    expect(screen.getByTestId("frame").textContent).toBe("9:16");

    // Model B cannot frame 9:16, so adding it does move the frame.
    clickModel("Model B");
    const clamped = screen.getByTestId("frame").textContent;
    expect(clamped).not.toBe("9:16");

    // Taking it back out does not.
    clickModel("Model B");
    expect(screen.getByTestId("frame").textContent).toBe(clamped);
  });

  it("can empty the selection, and refuses to generate on an empty one", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    clickModel("Model A");
    clickModel("Model B");

    expect(screen.getByTestId("models").textContent).toBe("");
    expect(screen.getByRole("button", { name: /^generate/i })).toBeDisabled();
  });
});

describe("picking many models at once", () => {
  it("takes the whole catalog in one click", () => {
    render(<Harness initial={targetFor(["model-a"])} onGenerate={vi.fn()} />);

    clickOption("selectAllModels");

    expect(screen.getByTestId("models").textContent).toBe("model-a,model-b");
  });
});

describe("searching and clearing the model list", () => {
  it("unselects everything in one click", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    clickOption("unselectAllModels");

    expect(screen.getByTestId("models").textContent).toBe("");
  });

  it("filters by search, and select all acts on what is shown", () => {
    render(<Harness initial={targetFor([])} onGenerate={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("searchModels"), {
      target: { value: "Model B" },
    });
    clickOption("selectAllModels");

    expect(screen.getByTestId("models").textContent).toBe("model-b");
  });
});

describe("the batch ceiling", () => {
  it("brings the runs down rather than clipping the batch", () => {
    const onGenerate = vi.fn();
    render(
      <Harness
        catalog={catalogOf(5)}
        initial={targetFor(["many-0"])}
        onGenerate={onGenerate}
      />,
    );

    // Four runs of one model is well inside the ceiling; four runs of five is
    // not. Choosing the models second is the order that used to make the line
    // promise twenty images and the button buy twelve.
    clickChip("4");
    clickOption("selectAllModels");

    // Five clones of Model A at 4 credits each, two runs apiece.
    expect(
      screen.getByText('runPlanCredits:{"copies":2,"models":5,"credits":40}'),
    ).toBeInTheDocument();

    generate();
    const requests = onGenerate.mock.calls[0][0] as GenerationRequest[];
    expect(requests).toHaveLength(10);
  });

  it("never buys more than the ceiling, however many models there are", () => {
    const onGenerate = vi.fn();
    render(
      <Harness
        catalog={catalogOf(MAX_BATCH + 4)}
        initial={targetFor(["many-0"])}
        onGenerate={onGenerate}
      />,
    );

    clickOption("selectAllModels");
    generate();

    const requests = onGenerate.mock.calls[0][0] as GenerationRequest[];
    expect(requests).toHaveLength(MAX_BATCH);
    // One run each of as many models as fit, rather than several runs of an
    // arbitrary few.
    expect(new Set(requests.map((request) => request.modelId)).size).toBe(
      MAX_BATCH,
    );
  });
});
