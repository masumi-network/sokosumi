import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DriveTablesFilters } from "@/app/drive/components/drive-tables-filters";
import { DRIVE_HEADER_CONTROL_CLASS } from "@/app/drive/components/drive-view-layout";
import type { FilterDropdownMenuSection } from "@/components/common/filter-dropdown-menu";

/**
 * The shared dropdown is exercised by its own callers; what belongs to this
 * component is the shape it hands over — one Status section with both states
 * named, the active indicator, and the header row's control height. Capturing
 * the props is what lets those be asserted without Radix and cmdk in
 * happy-dom.
 */
const received = vi.hoisted(() => ({
  props: null as {
    buttonLabel: string;
    sections: FilterDropdownMenuSection[];
    showActiveIndicator?: boolean;
    triggerClassName?: string;
  } | null,
}));

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: {
    buttonLabel: string;
    sections: FilterDropdownMenuSection[];
    showActiveIndicator?: boolean;
    triggerClassName?: string;
  }) => {
    received.props = props;
    const section = props.sections[0];
    return (
      <div>
        <button type="button">{props.buttonLabel}</button>
        {section?.options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={section.value === option.value}
            onClick={() => section.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  },
}));

const labels = {
  title: "Filter",
  searchPlaceholder: "Search",
  emptyResults: "No results",
  statusLabel: "Status",
  active: "Active",
  archived: "Archived",
};

function renderFilters(
  archived: boolean,
  onArchivedChange = vi.fn<(next: boolean) => void>(),
) {
  render(
    <DriveTablesFilters
      archived={archived}
      onArchivedChange={onArchivedChange}
      labels={labels}
    />,
  );
  return onArchivedChange;
}

afterEach(() => {
  cleanup();
  received.props = null;
});

describe("DriveTablesFilters", () => {
  it("offers a Status section naming both states", () => {
    renderFilters(false);

    expect(received.props?.sections).toHaveLength(1);
    const section = received.props?.sections[0];
    expect(section?.id).toBe("status");
    expect(section?.label).toBe("Status");
    // Both states are named options rather than an "all" default: they are
    // disjoint sets, not a subset of everything this list can show.
    expect(section?.options.map((option) => option.value)).toEqual([
      "active",
      "archived",
    ]);
    expect(section?.options.map((option) => option.label)).toEqual([
      "Active",
      "Archived",
    ]);
    expect(section?.allLabel).toBeUndefined();
  });

  it("reports the current state rather than the pending action", () => {
    renderFilters(false);
    expect(received.props?.sections[0]?.value).toBe("active");

    cleanup();
    renderFilters(true);
    expect(received.props?.sections[0]?.value).toBe("archived");
  });

  it("tracks the archived state with the active indicator", () => {
    renderFilters(false);
    expect(received.props?.showActiveIndicator).toBe(false);

    cleanup();
    renderFilters(true);
    expect(received.props?.showActiveIndicator).toBe(true);
  });

  it("maps each option back to the boolean the page owns", async () => {
    const onArchivedChange = renderFilters(false);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Archived" }));
    expect(onArchivedChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(onArchivedChange).toHaveBeenLastCalledWith(false);
  });

  it("gives the trigger the Files header row's control height", () => {
    renderFilters(false);

    // `size="sm"` is `h-8` at every width, so without this the trigger is a
    // 32px touch target beside `New table`'s 40px, and 4px out of alignment.
    expect(received.props?.triggerClassName).toBe(DRIVE_HEADER_CONTROL_CLASS);
    expect(DRIVE_HEADER_CONTROL_CLASS).toContain("h-10");
    expect(DRIVE_HEADER_CONTROL_CLASS).toContain("@xl:h-8");
  });
});
