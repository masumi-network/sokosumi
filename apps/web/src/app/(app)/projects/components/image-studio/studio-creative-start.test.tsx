import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "@/../messages/en.json";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { StudioCreativeStart } from "./studio-creative-start";

describe("StudioCreativeStart", () => {
  // CI does not run the webkit layout test, so this keeps the trigger on the
  // same size as Select project and Start from a website beside it.
  it("uses the default button size of the empty state's other actions", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <StudioCreativeStart onApplyBrief={() => {}} onFocusPrompt={() => {}} />
      </NextIntlClientProvider>,
    );
    const trigger = screen.getByRole("button", {
      name: en.App.Studio.CreativeStart.open,
    });
    expect(trigger.className).toBe(cn(buttonVariants({ variant: "outline" })));
  });
});
