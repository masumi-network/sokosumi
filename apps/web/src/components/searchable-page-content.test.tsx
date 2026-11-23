import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ProjectFindButton } from "@/app/projects/components/project-find-button";
import english from "../../messages/en.json";
import { PageSearchRows } from "./page-list-search";
import { PageSearchField } from "./page-search-field";
import { SearchablePageContent } from "./searchable-page-content";

function Field({ label }: { label: string }) {
  const [value, setValue] = useState("");
  return (
    <PageSearchField
      value={value}
      onValueChange={setValue}
      placeholder={label}
    />
  );
}

describe("page content search", () => {
  it("ranks title matches above tag matches and restores the original rows on Escape", () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <SearchablePageContent>
          <ul>
            <PageSearchRows
              rows={[
                {
                  primary: ["Plan"],
                  secondary: ["launch"],
                  content: <li key="plan">Plan</li>,
                },
                {
                  primary: ["Launch notes"],
                  content: <li key="notes">Launch notes</li>,
                },
                {
                  primary: ["Backlog"],
                  content: <li key="backlog">Backlog</li>,
                },
              ]}
            />
          </ul>
        </SearchablePageContent>
      </NextIntlClientProvider>,
    );
    const field = screen.getByRole("searchbox");
    fireEvent.change(field, { target: { value: "LAUNCH" } });
    expect(
      screen.getAllByRole("listitem").map((node) => node.textContent),
    ).toEqual(["Launch notes", "Plan"]);
    expect(screen.getByRole("status")).toHaveTextContent("2 matches");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(
      screen.getAllByRole("listitem").map((node) => node.textContent),
    ).toEqual(["Plan", "Launch notes", "Backlog"]);
  });

  it.each(["ctrlKey", "metaKey"])(
    "uses %s+F in the current section and leaves open dialogs in control",
    (modifier) => {
      render(
        <NextIntlClientProvider locale="en" messages={english}>
          <div hidden>
            <Field label="Hidden" />
          </div>
          <section>
            <Field label="First" />
          </section>
          <section>
            <button type="button">Second section</button>
            <Field label="Second" />
          </section>
          <div role="dialog" aria-label="Edit">
            <input aria-label="Editor" />
          </div>
        </NextIntlClientProvider>,
      );
      screen.getByRole("button", { name: "Second section" }).focus();
      expect(fireEvent.keyDown(window, { key: "f", [modifier]: true })).toBe(
        false,
      );
      expect(screen.getByRole("searchbox", { name: "Second" })).toHaveFocus();
      const editor = within(screen.getByRole("dialog")).getByRole("textbox");
      editor.focus();
      expect(fireEvent.keyDown(editor, { key: "f", [modifier]: true })).toBe(
        true,
      );
      expect(editor).toHaveFocus();
    },
  );

  it("leaves browser find available on Home", () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <PathnameContext.Provider value="/">
          <SearchablePageContent sidebar>
            <h1>Home</h1>
          </SearchablePageContent>
        </PathnameContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
    expect(screen.queryByRole("searchbox")).toBeNull();
    for (const modifier of ["ctrlKey", "metaKey"]) {
      expect(fireEvent.keyDown(window, { key: "f", [modifier]: true })).toBe(
        true,
      );
    }
  });

  // A project's phone title row has the Find icon: the field waits out of
  // sight (sr-only, so focus inside the tap opens the keyboard) and Escape on
  // an empty field returns to the icon.
  it("opens a project's collapsed Find from its icon and returns focus", () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <PathnameContext.Provider value="/projects/p-1">
          <SearchablePageContent sidebar>
            <ProjectFindButton label="Find on this page" />
            <p>Launch</p>
          </SearchablePageContent>
        </PathnameContext.Provider>
      </NextIntlClientProvider>,
    );
    const input = screen.getByRole("searchbox");
    const toolbar = input.closest(".\\@container\\/page-toolbar");
    expect(toolbar?.className).toContain(
      "max-md:not-focus-within:has-[input:placeholder-shown]:sr-only",
    );
    const icon = screen.getByRole("button", { name: "Find on this page" });

    fireEvent.click(icon);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "launch" } });
    // `main` scrolls and its padding clears the header: the open bar docks
    // under the header, with no offset that would draw it over the title.
    expect(toolbar?.className).toContain("sticky");
    expect(toolbar?.className).toContain("-top-4");
    expect(toolbar?.className).toContain("md:top-0");
    expect(toolbar?.className).not.toContain("top-[calc");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(icon).toHaveFocus();
  });

  // Tabbing to a result control and back keeps the way back to the icon.
  it("returns focus to the Find icon after a trip through the result controls", () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <PathnameContext.Provider value="/projects/p-1">
          <SearchablePageContent sidebar>
            <ProjectFindButton label="Find on this page" />
            <p>Launch</p>
          </SearchablePageContent>
        </PathnameContext.Provider>
      </NextIntlClientProvider>,
    );
    const input = screen.getByRole("searchbox");
    const icon = screen.getByRole("button", { name: "Find on this page" });

    fireEvent.click(icon);
    fireEvent.change(input, { target: { value: "launch" } });
    const next = screen.getByRole("button", { name: "Next match" });
    next.focus();
    expect(next).toHaveFocus();
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(icon).toHaveFocus();
  });

  it("lets go of Escape once focus leaves Find", () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <PathnameContext.Provider value="/projects/p-1">
          <SearchablePageContent sidebar>
            <ProjectFindButton label="Find on this page" />
            <button type="button">Elsewhere</button>
          </SearchablePageContent>
        </PathnameContext.Provider>
      </NextIntlClientProvider>,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.click(screen.getByRole("button", { name: "Find on this page" }));
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveFocus();
  });

  it("keeps Find in sight on pages without an icon", () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <PathnameContext.Provider value="/studio">
          <SearchablePageContent sidebar>
            <p>Launch</p>
          </SearchablePageContent>
        </PathnameContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("searchbox").closest("div.flex-wrap")?.className,
    ).not.toContain("sr-only");
  });

  it("keeps the field focused and the query active across tabs within the same project", () => {
    function dashboard(params: string) {
      return (
        <NextIntlClientProvider locale="en" messages={english}>
          <PathnameContext.Provider value="/studio">
            <SearchParamsContext.Provider value={new URLSearchParams(params)}>
              <SearchablePageContent sidebar>
                <p>Launch</p>
              </SearchablePageContent>
            </SearchParamsContext.Provider>
          </PathnameContext.Provider>
        </NextIntlClientProvider>
      );
    }
    const { rerender } = render(dashboard("projectId=one&tab=accounts"));
    const input = screen.getByRole("searchbox");
    input.focus();
    fireEvent.change(input, { target: { value: "launch" } });
    rerender(dashboard("projectId=one&tab=campaigns"));
    expect(screen.getByRole("searchbox")).toHaveValue("launch");
    expect(input).toHaveFocus();
    rerender(dashboard("projectId=two&tab=campaigns"));
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("keeps the same focused search field inside the page when the window resizes", () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <header>
          <button type="button">Notifications</button>
        </header>
        <main>
          <PathnameContext.Provider value="/studio">
            <SearchParamsContext.Provider value={new URLSearchParams()}>
              <SearchablePageContent sidebar>
                <p>Launch</p>
              </SearchablePageContent>
            </SearchParamsContext.Provider>
          </PathnameContext.Provider>
        </main>
      </NextIntlClientProvider>,
    );
    const field = within(screen.getByRole("main")).getByRole("searchbox");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Launch" } });
    fireEvent(window, new Event("resize"));
    expect(within(screen.getByRole("main")).getByRole("searchbox")).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Launch");
    expect(
      within(screen.getByRole("banner")).queryByRole("searchbox"),
    ).toBeNull();
  });

  it("steps through visible dashboard text and excludes sidebar and hidden tab text", () => {
    render(
      <NextIntlClientProvider locale="en" messages={english}>
        <aside>Revenue</aside>
        <SearchablePageContent>
          <h2>Revenue</h2>
          <p>Revenue estimate</p>
          <div hidden>Revenue archive</div>
        </SearchablePageContent>
      </NextIntlClientProvider>,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "revenue" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
  });
});
