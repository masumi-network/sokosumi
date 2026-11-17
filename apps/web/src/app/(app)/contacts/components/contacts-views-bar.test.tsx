import type { ContactList } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContactsPresetTabs, ContactsViewMenus } from "./contacts-views-bar";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  createdAutomatically: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function renderBar(view = "all", organization: string | null = null) {
  const props = {
    view,
    onViewChange: vi.fn(),
    lists: [list({}), list({ id: "list-2", name: "Warm", kind: "smart" })],
    onNewList: vi.fn(),
    onEditList: vi.fn(),
    onDeleteList: vi.fn(),
    organization,
    organizations: [
      { name: "Cardano Foundation", count: 61 },
      { name: "Draper University", count: 4 },
    ],
    onOrganizationChange: vi.fn(),
    onCompanySearch: vi.fn(),
  };
  render(
    <>
      <ContactsPresetTabs {...props} />
      <ContactsViewMenus {...props} />
    </>,
  );
  return props;
}

describe("ContactsPresetTabs and ContactsViewMenus", () => {
  it("switches presets from the segmented control", async () => {
    const props = renderBar();
    expect(screen.getByRole("radio", { name: "presets.all" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "presets.mine" }));
    expect(props.onViewChange).toHaveBeenCalledWith("mine");
  });

  it("names the open list and offers to edit it", async () => {
    const props = renderBar("list-1");
    await userEvent.click(screen.getByRole("button", { name: /Investors/ }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "views.editList" }),
    );
    expect(props.onEditList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "list-1" }),
    );
  });

  it("asks Core to search companies, and filters by the one picked", async () => {
    const props = renderBar();
    await userEvent.click(
      screen.getByRole("button", { name: /views.companies/ }),
    );
    await userEvent.type(
      screen.getByPlaceholderText("views.findCompany"),
      "draper",
    );
    expect(props.onCompanySearch).toHaveBeenLastCalledWith("draper");
    await userEvent.click(screen.getByText("Draper University"));
    expect(props.onOrganizationChange).toHaveBeenCalledWith(
      "Draper University",
    );
  });

  it("shows the chosen company with a way back to all", async () => {
    const props = renderBar("all", "Cardano Foundation");
    expect(
      screen.getByRole("button", { name: /Cardano Foundation/ }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "views.clearCompany" }),
    );
    expect(props.onOrganizationChange).toHaveBeenCalledWith(null);
  });
});

describe("ContactsPresetTabs", () => {
  it("scrolls the selected preset into view, so a phone shows which view is open", () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    const { rerender } = render(
      <ContactsPresetTabs view="archived" onViewChange={vi.fn()} />,
    );
    expect(scrolled.at(-1)).toBe(
      screen.getByRole("radio", { name: "presets.archived" }),
    );
    rerender(<ContactsPresetTabs view="mine" onViewChange={vi.fn()} />);
    expect(scrolled.at(-1)).toBe(
      screen.getByRole("radio", { name: "presets.mine" }),
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      inline: "nearest",
    });
    // A re-render on the same view never moves the page, e.g. while scrolled
    // down a long list.
    const calls = scrolled.length;
    rerender(<ContactsPresetTabs view="mine" onViewChange={vi.fn()} />);
    expect(scrolled).toHaveLength(calls);
  });
});
