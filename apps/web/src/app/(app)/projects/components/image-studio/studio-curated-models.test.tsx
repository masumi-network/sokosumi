import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { curatedModels } from "./catalog";
import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type { StudioCatalog } from "./types";

/**
 * Which models the studio opens with, and whether that stays a suggestion.
 *
 * Core's default starts a new session alone; the shortlist offers other
 * models a person can add to run the same brief. The opening selection must
 * still come apart completely — down to none — or it is not a default, it is
 * a constraint on which models can be selected.
 *
 * Radix's menu and popover are stubbed the way `studio-composer.test.tsx` stubs
 * them, so the model entries are reachable by their text.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatter: () => ({ dateTime: () => "today" }),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  requestImageJobCancel: vi.fn(),
  prepareStudioAssetSocialMedia: vi.fn(),
  writeStudioAssetCaption: vi.fn(),
}));

vi.mock("./use-studio-state", () => ({
  useStudioState: () => ({
    state: { assets: [], jobs: [] },
    selectedAsset: null,
    selectAsset: vi.fn(),
    activeJobs: [],
    refresh: vi.fn().mockResolvedValue(undefined),
    loadOlder: vi.fn(),
    hasOlder: false,
    error: null,
  }),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    failed: [],
    queued: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
    lastErrorCode: null,
  }),
}));

vi.mock("@/components/ui/popover", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Popover: Passthrough,
    PopoverAnchor: Passthrough,
    PopoverTrigger: Passthrough,
    PopoverContent: Passthrough,
  };
});

/**
 * A catalog shaped like the real one: a ranked shortlist, out of order, with
 * unranked models around it.
 *
 * Core sends `models` curated-first, so a fixture that is *already* in the
 * right order cannot tell "read the rank" apart from "take the first few".
 */
function catalogWithShortlist(): StudioCatalog {
  const template = TEST_CATALOG.models[0];
  return {
    ...TEST_CATALOG,
    defaultModelId: "gemini-pro",
    models: [
      { ...template, id: "plain-a", label: "Plain A", curatedRank: null },
      {
        ...template,
        id: "gemini-pro",
        label: "Gemini 3 Pro Image",
        curatedRank: 3,
      },
      {
        ...template,
        id: "muse-image",
        label: "Meta Muse Image",
        curatedRank: 1,
      },
      { ...template, id: "plain-b", label: "Plain B", curatedRank: null },
      { ...template, id: "ranked-2", label: "Ranked 2", curatedRank: 2 },
    ],
  };
}

function mount(catalog: StudioCatalog) {
  return render(
    <ImageStudio
      catalog={catalog}
      initialSelectedAssetId={null}
      initialState={{ assets: [], jobs: [], sessions: [] } as never}
      labels={TEST_LABELS}
      projectId="p"
    />,
  );
}

/** The model entries, in render order, with whether each is selected. */
function modelEntries() {
  return screen.getAllByRole("checkbox").map((entry) => ({
    // A row is the model's name, then its price, then its description, so the
    // name is the first element rather than the row's whole text.
    label: entry.querySelector(".font-medium")?.textContent?.trim() ?? "",
    checked: entry.getAttribute("aria-checked") === "true",
  }));
}

describe("curatedModels", () => {
  it("takes the ranked rows, in rank order, and nothing else", () => {
    expect(curatedModels(catalogWithShortlist()).map((m) => m.id)).toEqual([
      "muse-image",
      "ranked-2",
      "gemini-pro",
    ]);
  });

  it("falls back to the catalog's own default when nothing is ranked", () => {
    const unranked: StudioCatalog = {
      ...TEST_CATALOG,
      defaultModelId: "model-b",
      models: TEST_CATALOG.models.map((model) => ({
        ...model,
        curatedRank: null,
      })),
    };

    // A catalog with no shortlist still has to open on something: an empty
    // composer would offer no frame, no resolution and no format at all.
    expect(curatedModels(unranked).map((m) => m.id)).toEqual(["model-b"]);
  });
});

describe("opening the studio", () => {
  it("pre-selects only Gemini Pro even when Muse is ranked first", () => {
    mount(catalogWithShortlist());

    const selected = modelEntries()
      .filter((entry) => entry.checked)
      .map((entry) => entry.label);
    expect(selected).toEqual(["Gemini 3 Pro Image"]);

    // Five models offered, only Core's default chosen.
    expect(modelEntries()).toHaveLength(5);
  });

  it("prices only the opening default until another model is added", () => {
    mount(catalogWithShortlist());

    // One clone of a 4-credit model, one run.
    expect(
      screen.getByText('runPlanCredits:{"copies":1,"models":1,"credits":4}'),
    ).toBeInTheDocument();
  });
});

describe("editing the opening selection", () => {
  it("lets every last model be unselected", () => {
    mount(catalogWithShortlist());

    for (const label of ["Gemini 3 Pro Image"]) {
      const entry = screen
        .getAllByRole("checkbox")
        .find((node) => node.textContent?.includes(label));
      if (!entry) throw new Error(`no entry for ${label}`);
      fireEvent.click(entry);
    }

    // Down to none. The last one used to refuse, which made the control look
    // broken rather than the state look empty.
    expect(modelEntries().every((entry) => !entry.checked)).toBe(true);
    expect(screen.getByText("noModelSelected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^generateOne/ })).toBeDisabled();
  });

  it("takes the whole catalog, shortlist or not", () => {
    mount(catalogWithShortlist());

    const selectAll = screen
      .getAllByRole("button")
      .find((node) => node.textContent?.trim() === "selectAllModels");
    if (!selectAll) throw new Error("no select-all control");
    fireEvent.click(selectAll);

    expect(modelEntries().every((entry) => entry.checked)).toBe(true);
  });
});
