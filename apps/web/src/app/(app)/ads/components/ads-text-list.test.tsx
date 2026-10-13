import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { Form } from "@/components/ui/form";
import {
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchFormValues,
} from "@/lib/ads/google-search";
import messages from "../../../../../messages/en.json";
import { AdsTextList } from "./ads-text-list";

const CALLOUTS = GOOGLE_SEARCH_LIMITS.callouts;
const HEADLINES = GOOGLE_SEARCH_LIMITS.headlines;

function Harness({
  name,
  values,
}: {
  name: "headlines" | "callouts";
  values: string[];
}) {
  const form = useForm<GoogleSearchFormValues>({
    defaultValues: { [name]: values },
  });
  return (
    <Form {...form}>
      <AdsTextList limits={GOOGLE_SEARCH_LIMITS[name]} name={name} />
    </Form>
  );
}

function renderList(name: "headlines" | "callouts", values: string[]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Harness name={name} values={values} />
    </NextIntlClientProvider>,
  );
  return userEvent.setup();
}

const callouts = () => screen.queryAllByLabelText(/^Callout \d+$/);
const add = () => screen.getByRole("button", { name: "Add callout" });

describe("AdsTextList", () => {
  it("starts with no rows when the minimum is 0 and adds one per click", async () => {
    const user = renderList("callouts", []);
    expect(callouts()).toHaveLength(0);

    await user.click(add());
    await user.click(add());

    expect(callouts()).toHaveLength(2);
  });

  it("stops adding at the maximum", async () => {
    const user = renderList("callouts", Array(CALLOUTS.max - 1).fill("x"));

    await user.click(add());

    expect(callouts()).toHaveLength(CALLOUTS.max);
    expect(screen.queryByRole("button", { name: "Add callout" })).toBeNull();
  });

  it("removes a row, keeping the others, and offers the add button again", async () => {
    const user = renderList("callouts", Array(CALLOUTS.max).fill("a"));
    await user.clear(callouts()[0]!);
    await user.type(callouts()[0]!, "first");

    await user.click(screen.getByRole("button", { name: "Remove callout 2" }));

    expect(callouts()).toHaveLength(CALLOUTS.max - 1);
    expect(callouts()[0]).toHaveValue("first");
    expect(add()).toBeVisible();
  });

  it("keeps the minimum rows: no remove buttons at the minimum", () => {
    renderList("headlines", Array(HEADLINES.min).fill(""));

    expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(
      HEADLINES.min,
    );
    expect(
      screen.queryByRole("button", { name: /^Remove headline/ }),
    ).toBeNull();
  });

  it("counts the trimmed text", async () => {
    const user = renderList("callouts", ["  Free  "]);

    expect(screen.getByText(`4/${CALLOUTS.length}`)).toBeVisible();

    await user.clear(callouts()[0]!);
    await user.type(callouts()[0]!, "   ");
    expect(screen.getByText(`0/${CALLOUTS.length}`)).toBeVisible();
  });

  it("turns the counter over the limit into a red one", () => {
    renderList("callouts", ["x".repeat(CALLOUTS.length + 1)]);

    expect(
      screen.getByText(`${CALLOUTS.length + 1}/${CALLOUTS.length}`),
    ).toHaveClass("text-destructive");
  });

  it("describes each input by its own counter", () => {
    renderList("callouts", ["One", "Three"]);

    const [first, second] = callouts();
    const counterOf = (input: HTMLElement | undefined) =>
      document.getElementById(
        input?.getAttribute("aria-describedby")?.split(" ").at(-1) ?? "",
      );

    expect(counterOf(first)).toHaveTextContent(`3/${CALLOUTS.length}`);
    expect(counterOf(second)).toHaveTextContent(`5/${CALLOUTS.length}`);
  });
});
