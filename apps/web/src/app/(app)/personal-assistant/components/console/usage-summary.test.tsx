import type { SokoBotUsage } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../../messages/en.json";
import { UsageSummary } from "./usage-summary";

const usage: SokoBotUsage = {
  turns: 12,
  inputTokens: 40_000,
  outputTokens: 2_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 42_000,
  costUsd: 0.31,
  billableCostUsd: 0.31,
  credits: 31,
  delegatedCredits: 116,
  totalCredits: 147,
};

function renderUsage(detailed: boolean) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={messages}
      formats={createFormats("h12")}
    >
      <UsageSummary usage={usage} detailed={detailed} />
    </NextIntlClientProvider>,
  );
}

describe("UsageSummary", () => {
  it("shows one total with its split, and tokens, without model cost", () => {
    renderUsage(false);

    expect(screen.getByText("147")).toBeTruthy();
    expect(
      screen.getByText("31 on its own turns · 116 on Coworkers and Agents"),
    ).toBeTruthy();
    expect(screen.getByText("40,000 in · 2,000 out")).toBeTruthy();
    expect(screen.queryByText("Model cost")).toBeNull();
    expect(screen.queryByText(/12 turns/)).toBeNull();
  });

  it("adds the model cost and turn count when detailed", () => {
    renderUsage(true);

    expect(screen.getByText("Model cost")).toBeTruthy();
    expect(screen.getByText(/over 12 turns/)).toBeTruthy();
  });
});
