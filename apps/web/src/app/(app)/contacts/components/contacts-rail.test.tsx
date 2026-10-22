import type { ContactList } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContactsRail } from "./contacts-rail";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.name ? `${key}:${values.name}` : key,
}));

const list = (overrides: Partial<ContactList>): ContactList => ({
  id: "list-1",
  name: "Investors",
  color: "violet",
  description: null,
  kind: "manual",
  smartFilter: null,
  count: 15,
  createdByUserId: null,
  createdBySokoBotId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function renderRail(view = "all") {
  const props = {
    view,
    onViewChange: vi.fn(),
    lists: [
      list({}),
      list({ id: "list-2", name: "Warm", kind: "smart", count: 3 }),
    ],
    onNewList: vi.fn(),
    onEditList: vi.fn(),
    onDeleteList: vi.fn(),
    onImport: vi.fn(),
  };
  render(<ContactsRail {...props} />);
  return props;
}

describe("ContactsRail", () => {
  it("shows the presets first, then each list with its live count", () => {
    renderRail();
    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons.slice(0, 6)).toEqual([
      "presets.all",
      "presets.mine",
      "presets.followUps",
      "presets.recent",
      "presets.stale",
      "presets.prospects",
    ]);
    expect(screen.getByRole("button", { name: /Investors\s*15/ })).toBeTruthy();
    expect(screen.getByLabelText("rail.smartList")).toBeTruthy();
  });

  it("marks the open view and changes it on click", () => {
    const props = renderRail("list-1");
    expect(
      screen.getByRole("button", { name: /Investors\s*15/ }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "presets.stale" }));
    expect(props.onViewChange).toHaveBeenCalledWith("stale");
  });

  it("starts a new list and an import", () => {
    const props = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "rail.newList" }));
    fireEvent.click(screen.getByRole("button", { name: "rail.import" }));
    expect(props.onNewList).toHaveBeenCalledOnce();
    expect(props.onImport).toHaveBeenCalledOnce();
  });
});
