import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import { useNormalizedQueryTab } from "./use-normalized-query-tab";

const ALL_TABS = ["first", "second", "third"] as const;
const REDUCED_TABS = ["first", "third"] as const;
type TabValue = (typeof ALL_TABS)[number];

function Harness({ enabledTabs }: { enabledTabs: readonly TabValue[] }) {
  const [activeTab, setTab] = useNormalizedQueryTab(
    "tab",
    enabledTabs,
    "first",
  );
  return (
    <div>
      <span data-testid="active-tab">{activeTab}</span>
      {enabledTabs.map((tab) => (
        <button key={tab} type="button" onClick={() => void setTab(tab)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

describe("useNormalizedQueryTab", () => {
  it("clears an invalid query tab while immediately rendering the default tab", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter
        searchParams="?tab=bogus"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness enabledTabs={ALL_TABS} />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("active-tab")).toHaveTextContent("first");
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBeNull();
  });

  it("does not write to the URL when the parameter is absent or already valid", () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter
        searchParams="?tab=second"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness enabledTabs={ALL_TABS} />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("active-tab")).toHaveTextContent("second");
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it("falls back during render and clears the URL when the selected tab is disabled", async () => {
    const onUrlUpdate = vi.fn();
    const { rerender } = render(
      <NuqsTestingAdapter
        searchParams="?tab=second"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness enabledTabs={ALL_TABS} />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("active-tab")).toHaveTextContent("second");

    rerender(
      <NuqsTestingAdapter
        searchParams="?tab=second"
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
        <Harness enabledTabs={REDUCED_TABS} />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByTestId("active-tab")).toHaveTextContent("first");
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBeNull();
  });

  it("updates the URL when switching to another enabled tab", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter searchParams="" onUrlUpdate={onUrlUpdate} hasMemory>
        <Harness enabledTabs={ALL_TABS} />
      </NuqsTestingAdapter>,
    );

    await user.click(screen.getByRole("button", { name: "third" }));

    expect(screen.getByTestId("active-tab")).toHaveTextContent("third");
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBe(
      "third",
    );
  });
});
