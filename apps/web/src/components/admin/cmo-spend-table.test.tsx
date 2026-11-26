import type { AdminCmoSpend } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { CmoSpendTable } from "./cmo-spend-table";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages: en, namespace } as never),
  getFormatter: async () => createFormatter({ locale: "en" }),
}));

const bot = (
  overrides: Partial<AdminCmoSpend["bots"][number]>,
): AdminCmoSpend["bots"][number] => ({
  sokoBotId: "bot_1",
  businessName: "nmkr.io",
  evalLane: false,
  ownerEmail: "owner@nmkr.io",
  turns: 4,
  totalUsd: 2,
  overheadUsd: 0,
  imagesCredits: 0,
  chargedCredits: 10,
  bySource: [],
  tools: [],
  planChecks: {
    checked: 0,
    withProblems: 0,
    drifted: 0,
    unavailable: 0,
    last: null,
  },
  ...overrides,
});

describe("CmoSpendTable", () => {
  it("offers eval Cusos behind a link that keeps the period", async () => {
    render(
      await CmoSpendTable({
        spend: { since: "2026-10-26T00:00:00.000Z", bots: [bot({})] },
        days: 7,
        periods: [7, 30],
        withEvals: false,
      }),
    );

    expect(
      screen
        .getByRole("link", { name: "Show eval Cusos" })
        .getAttribute("href"),
    ).toBe("/admin/cmo-spend?days=7&evals=include");
    expect(screen.queryByText("Eval")).toBeNull();
  });

  it("tags eval Cusos and keeps them in the period links when shown", async () => {
    render(
      await CmoSpendTable({
        spend: {
          since: "2026-10-26T00:00:00.000Z",
          bots: [bot({}), bot({ sokoBotId: "bot_eval", evalLane: true })],
        },
        days: 30,
        periods: [7, 30],
        withEvals: true,
      }),
    );

    expect(screen.getByText("Eval")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Hide eval Cusos" })
        .getAttribute("href"),
    ).toBe("/admin/cmo-spend?days=30");
    expect(
      screen.getByRole("link", { name: "7 days" }).getAttribute("href"),
    ).toBe("/admin/cmo-spend?days=7&evals=include");
  });
});
