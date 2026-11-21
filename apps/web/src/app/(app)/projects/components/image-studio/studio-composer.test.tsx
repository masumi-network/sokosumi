import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { StudioComposer } from "./studio-composer";
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

// happy-dom has no layout for next/image to measure a `fill` parent by.
vi.mock("next/image", () => import("@/test/next-image"));

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

const TARGET: StudioTarget = {
  settings: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
};

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
  );
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
  fireEvent.change(screen.getByRole("textbox", { name: "promptPlaceholder" }), {
    target: { value: prompt },
  });
  // By name rather than by an exact label: the button says "generateOne" for a
  // single image and "generateMany" with a count for a batch, which is the
  // whole point of it.
  fireEvent.click(screen.getByRole("button", { name: /^generate/i }));
}

describe("what the composer says without being opened", () => {
  it("uses the same side gutter as the chat composer", () => {
    render(<Harness initial={TARGET} onGenerate={vi.fn()} />);
    expect(
      screen
        .getByRole("textbox", { name: "promptPlaceholder" })
        .closest("form"),
    ).toHaveClass("px-3", "md:px-5");
  });

  it("summarises the frame, resolution and format", () => {
    render(<Harness initial={TARGET} onGenerate={vi.fn()} />);
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
  it("prices one image on the automatic model", () => {
    render(<Harness initial={TARGET} onGenerate={vi.fn()} />);
    expect(
      screen.getByText('placementPlanCredits:{"count":1,"credits":4}'),
    ).toBeInTheDocument();
  });

  it("multiplies by the runs asked for", () => {
    render(<Harness initial={TARGET} onGenerate={vi.fn()} />);

    clickChip("3");

    expect(
      screen.getByText('placementPlanCredits:{"count":3,"credits":12}'),
    ).toBeInTheDocument();
  });

  it("prices a per-megapixel model off the frame it would run at", () => {
    render(
      <Harness
        catalog={{ ...TEST_CATALOG, defaultModelId: "model-b" }}
        initial={TARGET}
        onGenerate={vi.fn()}
      />,
    );
    clickChip("2K");

    expect(
      screen.getByText('placementPlanCredits:{"count":1,"credits":21}'),
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
      <Harness catalog={unpriceable} initial={TARGET} onGenerate={vi.fn()} />,
    );

    expect(screen.getByText('placementPlan:{"count":1}')).toBeInTheDocument();
    expect(screen.getByText("creditsUnderivable")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("keeps Shift+Enter for a new line without buying images", () => {
    const onGenerate = vi.fn();
    render(<Harness initial={TARGET} onGenerate={onGenerate} />);

    const prompt = screen.getByLabelText("promptPlaceholder");
    fireEvent.change(prompt, { target: { value: "a red fox" } });
    fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });

    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("buys exactly the batch it described", () => {
    const onGenerate = vi.fn();
    render(<Harness initial={TARGET} onGenerate={onGenerate} />);

    clickChip("3");
    generate();

    const requests = onGenerate.mock.calls[0][0] as GenerationRequest[];
    expect(requests).toHaveLength(3);
    expect(requests.every(({ modelId }) => modelId === "model-a")).toBe(true);
  });
});

describe("how a price is explained", () => {
  it("says the unit once, in the singular", () => {
    render(<Harness initial={TARGET} onGenerate={vi.fn()} />);

    expect(
      screen.getByText(
        'priceBasis:{"price":"$0.04","unit":"PriceUnits.images"}',
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
      <Harness catalog={perSecond} initial={TARGET} onGenerate={vi.fn()} />,
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

describe("prompt shortcuts and length limits", () => {
  it.each([{ metaKey: true }, { ctrlKey: true }])(
    "generates with the explicit shortcut %j",
    (modifier) => {
      const onGenerate = vi.fn();
      render(<Harness initial={TARGET} onGenerate={onGenerate} />);
      const prompt = screen.getByLabelText("promptPlaceholder");
      fireEvent.change(prompt, { target: { value: "a fox" } });
      fireEvent.keyDown(prompt, { key: "Enter", ...modifier });
      expect(onGenerate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "does not buy images while composing text %j",
    (composition) => {
      const onGenerate = vi.fn();
      render(<Harness initial={TARGET} onGenerate={onGenerate} />);
      const prompt = screen.getByLabelText("promptPlaceholder");
      fireEvent.change(prompt, { target: { value: "a fox" } });
      fireEvent.keyDown(prompt, {
        key: "Enter",
        metaKey: true,
        ...composition,
      });
      expect(onGenerate).not.toHaveBeenCalled();
    },
  );

  it("keeps an oversized pasted brief, explains the limit and blocks click and keyboard purchases", () => {
    const onGenerate = vi.fn();
    render(<Harness initial={TARGET} onGenerate={onGenerate} />);
    const prompt = screen.getByLabelText("promptPlaceholder");
    fireEvent.change(prompt, { target: { value: "x".repeat(4001) } });
    expect(prompt).toHaveValue("x".repeat(4001));
    expect(prompt).toHaveAttribute("aria-invalid", "true");
    expect(prompt).toHaveAccessibleDescription(/promptTooLong/);
    expect(screen.getByRole("alert")).toHaveTextContent(
      'promptTooLong:{"limit":4000}',
    );
    expect(screen.getByRole("button", { name: /^generate/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^generate/ }));
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });
    expect(onGenerate).not.toHaveBeenCalled();

    fireEvent.change(prompt, { target: { value: `  ${"x".repeat(4000)}  ` } });
    expect(prompt).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: /^generate/ }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0][0][0].prompt).toBe("x".repeat(4000));
  });
});
