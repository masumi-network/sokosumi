import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

import type { WorkspaceLabel } from "@sokosumi/core-client";

import {
  BULK_CATEGORY_BUTTONS,
  DriveBulkCategoryPicker,
} from "./drive-bulk-category-picker";

/**
 * Every category a workspace has is reachable from the bulk bar.
 *
 * It took the first four and stopped. On ten categories, six could not be
 * set in bulk at all and nothing said they existed, so the person who had
 * just selected forty files could only conclude those categories were not
 * allowed here. There is no other bulk category control in the app.
 *
 * Reviewer A's acceptance check 12: either all of them are reachable, or
 * the bar says how many are not shown *and* the hidden ones can be opened
 * from that same bar. These assert the second shape — a count that is the
 * label on the control that reaches them, rather than a count on its own,
 * which is the same dead end with better manners.
 */

const NAMES = [
  "Contracts",
  "Invoices",
  "Reports",
  "Designs",
  "Policies",
  "Research",
  "Minutes",
  "Proposals",
  "Receipts",
  "Templates",
];

function categories(count = NAMES.length): WorkspaceLabel[] {
  return NAMES.slice(0, count).map(
    (displayName, index) =>
      ({
        id: `category-${index}`,
        kind: "CATEGORY",
        displayName,
        description: null,
        archived: false,
        vocabularyVersion: 1,
      }) as WorkspaceLabel,
  );
}

function renderPicker(count?: number) {
  const onPick = vi.fn();
  render(
    <DriveBulkCategoryPicker
      categories={categories(count)}
      disabled={false}
      onPick={onPick}
    />,
  );
  return onPick;
}

describe("setting a category across a selection", () => {
  it("says how many did not fit on the bar", async () => {
    renderPicker();

    const more = await screen.findByTestId("bulk-more-categories");
    // Ten, four on the bar, so six behind the control — and the number is
    // on the control rather than beside it.
    expect(more.textContent).toContain(
      String(NAMES.length - BULK_CATEGORY_BUTTONS),
    );
  });

  it("reaches every category in the workspace", async () => {
    renderPicker();

    await userEvent.click(await screen.findByTestId("bulk-more-categories"));

    for (const name of NAMES) {
      expect(
        await screen.findByText(name),
        `${name} cannot be reached from the bulk bar`,
      ).toBeInTheDocument();
    }
  });

  it("applies the one picked from it", async () => {
    // A list that looks reachable and does nothing is not reachable.
    const onPick = renderPicker();

    await userEvent.click(await screen.findByTestId("bulk-more-categories"));
    await userEvent.click(await screen.findByText("Templates"));

    expect(onPick).toHaveBeenCalledWith("category-9");
  });

  it("still applies the ones on the bar", async () => {
    // The quick path has to keep working, or reaching everything has been
    // bought by making the common case worse.
    const onPick = renderPicker();

    await userEvent.click(
      await screen.findByText(`bulkSetCategory:{"name":"Contracts"}`),
    );

    expect(onPick).toHaveBeenCalledWith("category-0");
  });

  it("offers no control when everything already fits", () => {
    // Otherwise every small workspace grows an empty "0 more".
    renderPicker(BULK_CATEGORY_BUTTONS);

    expect(
      screen.queryByTestId("bulk-more-categories"),
    ).not.toBeInTheDocument();
  });
});
