import type { AdminAdEvalsDashboard } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { AdEvalsDashboard } from "./ad-evals-dashboard";

vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "App.Admin.AdEvals",
    }),
  getFormatter: async () => createFormatter({ locale: "en" }),
}));
vi.mock("./export-ad-evals-button", () => ({
  ExportAdEvalsButton: () => <button type="button">Download JSONL</button>,
}));

const DATA: AdminAdEvalsDashboard = {
  minimumWorkspaces: 5,
  leaderboard: [
    {
      model: "ideogram-v3",
      template: "social-post",
      aspect: "4:5",
      workspaceCount: 8,
      suppressed: false,
      n: 42,
      thumbN: 30,
      pairwiseN: 20,
      judgeN: 42,
      thumbRate: 0.8,
      pairwiseWinRate: 0.65,
      judgeMean: 4.2,
      thumbRateCi: { lower: 0.63, upper: 0.9 },
      pairwiseWinRateCi: { lower: 0.43, upper: 0.82 },
      judgeMeanCi: { lower: 3.9, upper: 4.5 },
    },
  ],
  agreement: [
    {
      criterion: "brand_fit",
      signal: "thumb",
      rho: 0.22,
      n: 30,
      lowAgreement: true,
    },
  ],
};

describe("AdEvalsDashboard", () => {
  it("shows useful empty states and the training export", async () => {
    render(
      await AdEvalsDashboard({
        data: { minimumWorkspaces: 5, leaderboard: [], agreement: [] },
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Ad evals" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No ad evaluations from consenting workspaces yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No matched judge scores and human feedback yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download JSONL" }),
    ).toBeInTheDocument();
  });

  it("shows model metrics, confidence intervals, sample size and low agreement", async () => {
    render(await AdEvalsDashboard({ data: DATA }));
    const row = screen.getByRole("row", { name: /ideogram-v3/ });
    expect(within(row).getByText("80%")).toBeInTheDocument();
    expect(within(row).getByText("63%–90%")).toBeInTheDocument();
    expect(within(row).getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Brand fit")).toBeInTheDocument();
    expect(screen.getByText("0.22")).toBeInTheDocument();
    expect(screen.getByText("Low agreement")).toBeInTheDocument();
  });

  it("withholds scores for cells below the workspace threshold", async () => {
    render(
      await AdEvalsDashboard({
        data: {
          ...DATA,
          leaderboard: [
            { ...DATA.leaderboard[0], workspaceCount: 4, suppressed: true },
          ],
        },
      }),
    );
    expect(screen.getByText("Fewer than 5 workspaces")).toBeInTheDocument();
    expect(screen.queryByText("80%")).toBeNull();
    expect(screen.queryByText("4.2")).toBeNull();
  });
});
