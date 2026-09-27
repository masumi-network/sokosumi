import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { MAX_BATCH, StudioComposer } from "./studio-composer";
import { TEST_CATALOG } from "./studio-fixtures";
import type { StudioCatalog, StudioLabels, StudioTarget } from "./types";
import type { QueuedGeneration } from "./use-generation-queue";

/**
 * The composer, driven the way a person drives it.
 *
 * The rule under test: a model that cannot frame the chosen placement must
 * not survive in the selection, and must never reach a request. Asserting
 * only that the fixture *has* such a model proves nothing about the
 * composer — this drives the actual controls.
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

vi.mock("@/components/ui/dropdown-menu", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: Passthrough,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuLabel: Passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuCheckboxItem: ({
      checked,
      children,
      disabled,
      onSelect,
    }: {
      checked?: boolean;
      children?: React.ReactNode;
      disabled?: boolean;
      onSelect?: (event: { preventDefault: () => void }) => void;
    }) => (
      <button
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onSelect?.({ preventDefault: () => {} })}
        role="menuitemcheckbox"
        type="button"
      >
        {children}
      </button>
    ),
    DropdownMenuRadioGroup: ({
      children,
      onValueChange,
    }: {
      children?: React.ReactNode;
      onValueChange?: (value: string) => void;
    }) => (
      <div
        data-testid="radio-group"
        onClick={(event) => {
          const value = (event.target as HTMLElement)
            .closest("[data-value]")
            ?.getAttribute("data-value");
          if (value !== null && value !== undefined) onValueChange?.(value);
        }}
      >
        {children}
      </div>
    ),
    DropdownMenuRadioItem: ({
      children,
      value,
    }: {
      children?: React.ReactNode;
      value: string;
    }) => (
      <button data-value={value} role="menuitemradio" type="button">
        {children}
      </button>
    ),
  };
});

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
    placementId: null,
    settings: {
      aspectRatio: "1:1",
      resolution: "1K",
      outputFormat: "png",
      seed: null,
      placementId: null,
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
  onGenerate: (requests: QueuedGeneration[]) => void;
}) {
  const [target, setTarget] = useState<StudioTarget>(initial);
  const [prompt, setPrompt] = useState("");
  return (
    <>
      <StudioComposer
        busy={false}
        catalog={catalog}
        labels={LABELS}
        onClearReferences={() => {}}
        onGenerate={onGenerate}
        onPromptChange={setPrompt}
        onTargetChange={(update) => setTarget((current) => update(current))}
        projectId="p"
        prompt={prompt}
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

/**
 * Click the control whose visible text says `text`.
 *
 * By element rather than by role: the stubbed menu items carry
 * `menuitemcheckbox`/`menuitemradio`, which replaces the implicit button
 * role, so a role query would miss exactly the options under test.
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

function generate(prompt = "a calm product shot") {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: prompt } });
  // By name rather than by an exact label: the button says "generateOne" for a
  // single image and "generateMany" with a count for a batch, which is the
  // whole point of it.
  fireEvent.click(screen.getByRole("button", { name: /^generate/i }));
}

describe("choosing a placement some selected models cannot frame", () => {
  it("drops the model that cannot frame it", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);
    expect(screen.getByTestId("models").textContent).toBe("model-a,model-b");

    clickOption("Instagram Reels");

    // model-b has no 9:16, so it cannot serve this placement and must go.
    expect(screen.getByTestId("models").textContent).toBe("model-a");
    expect(screen.getByTestId("placement").textContent).toBe("reels");
    expect(screen.getByTestId("frame").textContent).toBe("9:16");
  });

  it("never builds a request for a model that cannot frame it", () => {
    const onGenerate = vi.fn();
    render(<Harness initial={BOTH_MODELS} onGenerate={onGenerate} />);

    clickOption("Instagram Reels");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a vertical product shot" },
    });
    clickOption("generateOne");

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

    clickOption("Instagram Reels");

    // Refusing silently would make the option look broken; the composer picks
    // the first catalog model that can serve it instead.
    expect(screen.getByTestId("models").textContent).toBe("model-a");
    expect(screen.getByTestId("placement").textContent).toBe("reels");
  });

  it("leaves the selection alone when the placement is cleared", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);
    clickOption("Instagram Reels");
    expect(screen.getByTestId("models").textContent).toBe("model-a");

    clickOption("placementNone");

    expect(screen.getByTestId("placement").textContent).toBe("none");
    // Clearing a placement is not a request to reframe or to re-add models.
    expect(screen.getByTestId("frame").textContent).toBe("9:16");
    expect(screen.getByTestId("models").textContent).toBe("model-a");
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
 * What the composer promises before the money is spent.
 *
 * Modelled on fal's Sandbox, which puts the run's estimated cost in the footer
 * of the prompt bar — so the line has to be a true statement about the batch
 * the button will actually buy, including when the ceiling has cut it down.
 */
describe("the line above Generate", () => {
  it("says how many runs, across how many models, and what that is worth", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    // Model A is $0.04 at 1K and Model B is $0.10. See TEST_CATALOG.
    expect(
      screen.getByText(
        'runPlanEstimated:{"copies":1,"models":2,"cost":"$0.14"}',
      ),
    ).toBeInTheDocument();
  });

  it("multiplies by the runs asked for", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    clickChip("3");

    expect(
      screen.getByText(
        'runPlanEstimated:{"copies":3,"models":2,"cost":"$0.42"}',
      ),
    ).toBeInTheDocument();
  });

  it("stays silent about money when one model has no published price", () => {
    render(<Harness initial={BOTH_MODELS} onGenerate={vi.fn()} />);

    // Model B publishes nothing at 2K, so the total would be the price of half
    // the batch wearing the whole batch's label.
    clickChip("2K");

    expect(
      screen.getByText('runPlan:{"copies":1,"models":2}'),
    ).toBeInTheDocument();
    expect(screen.getByText("estimateUnpriced")).toBeInTheDocument();
  });

  it("buys exactly the batch it described", () => {
    const onGenerate = vi.fn();
    render(<Harness initial={BOTH_MODELS} onGenerate={onGenerate} />);

    clickChip("3");
    generate();

    const requests = onGenerate.mock.calls[0][0] as QueuedGeneration[];
    expect(requests).toHaveLength(6);
    // Round-robin: the first pass covers every model, so a batch is comparable
    // while it is still arriving.
    expect(requests.slice(0, 2).map((request) => request.modelId)).toEqual([
      "model-a",
      "model-b",
    ]);
  });
});

describe("picking many models at once", () => {
  it("takes the whole catalog in one click", () => {
    render(<Harness initial={targetFor(["model-a"])} onGenerate={vi.fn()} />);

    clickOption("selectAllModels");

    expect(screen.getByTestId("models").textContent).toBe("model-a,model-b");
  });

  it("takes only the models that can frame the chosen placement", () => {
    render(<Harness initial={targetFor(["model-a"])} onGenerate={vi.fn()} />);

    clickOption("Instagram Reels");
    clickOption("selectAllModels");

    // model-b has no 9:16. "All" must not mean "all, and then silently reframe
    // the ones that cannot".
    expect(screen.getByTestId("models").textContent).toBe("model-a");
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

    expect(
      screen.getByText(
        'runPlanEstimated:{"copies":2,"models":5,"cost":"$0.40"}',
      ),
    ).toBeInTheDocument();

    generate();
    const requests = onGenerate.mock.calls[0][0] as QueuedGeneration[];
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

    const requests = onGenerate.mock.calls[0][0] as QueuedGeneration[];
    expect(requests).toHaveLength(MAX_BATCH);
    // One run each of as many models as fit, rather than several runs of an
    // arbitrary few.
    expect(new Set(requests.map((request) => request.modelId)).size).toBe(
      MAX_BATCH,
    );
  });
});
