import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsKeywordInput } from "./ads-keyword-input";

const onChangeMock = vi.fn();

function Host({ initial = [] }: { initial?: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="keywords">Keywords</label>
      <AdsKeywordInput
        id="keywords"
        value={value}
        onChange={(next) => {
          onChangeMock(next);
          setValue(next);
        }}
      />
    </>
  );
}

function renderInput(initial?: string[]) {
  onChangeMock.mockClear();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Host initial={initial} />
    </NextIntlClientProvider>,
  );
  return userEvent.setup();
}

const chips = () =>
  screen.queryAllByRole("listitem").map((item) => item.textContent);

describe("AdsKeywordInput", () => {
  it("adds a chip on Enter and clears the field", async () => {
    const user = renderInput();

    await user.type(screen.getByLabelText("Keywords"), "running shoes{Enter}");

    expect(chips()).toEqual(["running shoes"]);
    expect(screen.getByLabelText("Keywords")).toHaveValue("");
  });

  it("adds a chip on comma, and one for each comma-separated part when pasted", async () => {
    const user = renderInput();
    const input = screen.getByLabelText("Keywords");

    await user.type(input, "trail shoes,");
    await user.click(input);
    await user.paste("hiking boots, sandals ,");

    expect(chips()).toEqual(["trail shoes", "hiking boots", "sandals"]);
  });

  it("keeps typed text when focus leaves", async () => {
    const user = renderInput();

    await user.type(screen.getByLabelText("Keywords"), "sandals");
    await user.tab();

    expect(chips()).toEqual(["sandals"]);
  });

  it("ignores blanks", async () => {
    const user = renderInput();

    await user.type(screen.getByLabelText("Keywords"), "   {Enter},");

    expect(chips()).toEqual([]);
    expect(onChangeMock).not.toHaveBeenCalled();
  });

  it("drops a keyword already there, ignoring case", async () => {
    const user = renderInput(["Running Shoes"]);

    await user.type(screen.getByLabelText("Keywords"), "running shoes{Enter}");

    expect(chips()).toEqual(["Running Shoes"]);
    expect(onChangeMock).not.toHaveBeenCalled();
  });

  it("stops at ten keywords, staying focusable and saying so", async () => {
    const user = renderInput(Array.from({ length: 9 }, (_, i) => `k${i}`));
    const input = screen.getByLabelText("Keywords");

    await user.type(input, "tenth,");
    expect(chips()).toHaveLength(10);

    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute("readonly");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Keyword limit reached",
    );
    input.focus();
    expect(input).toHaveFocus();
    await user.keyboard("eleventh,");
    expect(chips()).toHaveLength(10);
  });

  it("cuts a pasted keyword to 80 characters", async () => {
    const user = renderInput();
    const input = screen.getByLabelText("Keywords");

    await user.click(input);
    await user.paste(`${"a".repeat(100)},`);

    expect(chips()).toEqual(["a".repeat(80)]);
  });

  it("removes a chip with its button, freeing a slot", async () => {
    const user = renderInput(["one", "two"]);

    await user.click(screen.getByRole("button", { name: "Remove one" }));

    expect(chips()).toEqual(["two"]);
    expect(onChangeMock).toHaveBeenLastCalledWith(["two"]);
  });

  it("moves focus back to the field after a chip is removed", async () => {
    const user = renderInput(["one", "two"]);

    await user.click(screen.getByRole("button", { name: "Remove one" }));

    expect(screen.getByLabelText("Keywords")).toHaveFocus();
  });

  it("lets a new keyword in once a full list loses one", async () => {
    const user = renderInput(Array.from({ length: 10 }, (_, i) => `k${i}`));

    await user.click(screen.getByRole("button", { name: "Remove k0" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("Keywords")).not.toHaveAttribute("readonly");

    await user.type(screen.getByLabelText("Keywords"), "fresh,");
    expect(chips()).toContain("fresh");
  });
});
