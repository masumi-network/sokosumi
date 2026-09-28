import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { curatedModels } from "./catalog";
import { ImageStudio } from "./image-studio";
import { TEST_CATALOG } from "./studio-fixtures";
import type { StudioCatalog, StudioLabels } from "./types";

/**
 * Which models the studio opens with, and whether that stays a suggestion.
 *
 * The point of the shortlist is that one brief reaches five models without
 * anybody assembling the selection first. The point of it being *only* the
 * opening selection is that it must come apart completely — down to none — or
 * it is not a default, it is a constraint.
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
  reviewImageVersion: vi.fn(),
  clearImageVersionReview: vi.fn(),
  requestImageJobCancel: vi.fn(),
}));

vi.mock("./use-studio-state", () => ({
  useStudioState: () => ({
    state: { assets: [], jobs: [] },
    selectedAsset: null,
    selectAsset: vi.fn(),
    activeJobs: [],
    applyAsset: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    loadOlder: vi.fn(),
    hasOlder: false,
    error: null,
  }),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    queued: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
    lastError: null,
    lastErrorCode: null,
    clearError: vi.fn(),
  }),
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
    DropdownMenuCheckboxItem: ({
      checked,
      children,
      onSelect,
    }: {
      checked?: boolean;
      children?: React.ReactNode;
      onSelect?: (event: { preventDefault: () => void }) => void;
    }) => (
      <button
        aria-checked={checked}
        data-checked={checked}
        onClick={() => onSelect?.({ preventDefault: () => {} })}
        role="menuitemcheckbox"
        type="button"
      >
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
  {
    templateLabels: new Proxy({}, { get: (_target, key: string) => key }),
  } as Record<string, unknown>,
  { get: (target, key: string) => target[key] ?? key },
) as unknown as StudioLabels;

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
    defaultModelId: "ranked-1",
    models: [
      { ...template, id: "plain-a", label: "Plain A", curatedRank: null },
      { ...template, id: "ranked-3", label: "Ranked 3", curatedRank: 3 },
      { ...template, id: "ranked-1", label: "Ranked 1", curatedRank: 1 },
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
      labels={LABELS}
      projectId="p"
    />,
  );
}

/** The model entries, in render order, with whether each is selected. */
function modelEntries() {
  return screen.getAllByRole("menuitemcheckbox").map((entry) => ({
    label: entry.textContent?.split("Fast")[0]?.trim() ?? "",
    checked: entry.getAttribute("data-checked") === "true",
  }));
}

describe("curatedModels", () => {
  it("takes the ranked rows, in rank order, and nothing else", () => {
    expect(curatedModels(catalogWithShortlist()).map((m) => m.id)).toEqual([
      "ranked-1",
      "ranked-2",
      "ranked-3",
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
  it("pre-selects the shortlist and leaves the rest alone", () => {
    mount(catalogWithShortlist());

    const selected = modelEntries()
      .filter((entry) => entry.checked)
      .map((entry) => entry.label);
    expect(selected).toEqual(["Ranked 3", "Ranked 1", "Ranked 2"]);

    // Five models offered, three of them chosen.
    expect(modelEntries()).toHaveLength(5);
  });

  it("prices the whole shortlist, not just the first model", () => {
    mount(catalogWithShortlist());

    // Three clones of a 4-credit model, one run each.
    expect(
      screen.getByText('runPlanCredits:{"copies":1,"models":3,"credits":12}'),
    ).toBeInTheDocument();
  });
});

describe("editing the opening selection", () => {
  it("lets every last model be unselected", () => {
    mount(catalogWithShortlist());

    for (const label of ["Ranked 1", "Ranked 2", "Ranked 3"]) {
      const entry = screen
        .getAllByRole("menuitemcheckbox")
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
