import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NotificationEmptyState } from "./notification-empty-state";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("NotificationEmptyState", () => {
  // Each view is empty for a different reason, so each one says a different
  // thing. One shared string would tell a reader in Needs you that they have
  // no notifications at all.
  it.each([
    ["all" as const, "emptyState", "emptyStateDescription"],
    ["unread" as const, "emptyUnreadState", "emptyUnreadStateDescription"],
    [
      "needs-action" as const,
      "emptyNeedsYouState",
      "emptyNeedsYouStateDescription",
    ],
  ])("says what %s is empty of", (view, title, description) => {
    render(<NotificationEmptyState view={view} onShowAll={() => {}} />);

    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(description)).toBeTruthy();
  });

  // All is not a lens over anything, so there is nowhere to go back to.
  it("offers no way out of All", () => {
    render(<NotificationEmptyState view="all" onShowAll={() => {}} />);

    expect(screen.queryByRole("button", { name: "showAll" })).toBeNull();
  });

  it.each(["unread" as const, "needs-action" as const])(
    "hands %s back to All on request",
    async (view) => {
      const onShowAll = vi.fn();
      render(<NotificationEmptyState view={view} onShowAll={onShowAll} />);

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "showAll" }));

      // The caller gets the button, because that button is about to
      // unmount and its focus has to go somewhere.
      expect(onShowAll).toHaveBeenCalledTimes(1);
      expect(onShowAll.mock.calls[0]?.[0]).toBe(
        screen.getByRole("button", { name: "showAll" }),
      );
    },
  );

  // The disc is decoration beside text that already names the state, so a
  // screen reader should not stop on it.
  it("keeps the icon out of the accessible name", () => {
    const { container } = render(
      <NotificationEmptyState view="all" onShowAll={() => {}} />,
    );

    const icon = container.querySelector("svg");

    // The icon has to exist before hiding it means anything: an absent
    // icon has no ancestor either, and the check would pass on nothing.
    expect(icon).not.toBeNull();
    expect(icon?.closest("[aria-hidden]")).not.toBeNull();
  });
});
