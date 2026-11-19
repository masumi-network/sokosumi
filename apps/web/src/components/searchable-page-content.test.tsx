import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it } from "vitest";
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

  it("keeps the field focused and the query active across tabs within the same project", () => {
    function dashboard(params: string) {
      return (
        <NextIntlClientProvider locale="en" messages={english}>
          <PathnameContext.Provider value="/ads">
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
