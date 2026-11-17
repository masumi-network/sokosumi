import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en.json";

import { TEST_CATALOG } from "./studio-fixtures";
import { StudioModelScoreboard } from "./studio-model-scoreboard";

const mocks = vi.hoisted(() => ({ scores: vi.fn() }));
vi.mock("@/lib/actions/image-studio/action", () => ({
  getStudioModelScoreboard: mocks.scores,
}));

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <StudioModelScoreboard catalog={TEST_CATALOG} projectId="project" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scores.mockResolvedValue({
    ok: true,
    value: {
      models: [
        {
          model: "model-a",
          comparisons: 25,
          winRate: 0.64,
          elo: 1042,
          provisional: false,
        },
        {
          model: "vendor/model-b",
          comparisons: 3,
          winRate: 0.5,
          elo: 1000,
          provisional: true,
        },
      ],
      minimumComparisons: 10,
    },
  });
});

describe("project model scoreboard", () => {
  it("loads on demand and renders model names, win rates, picks, and a sample note", async () => {
    mount();
    expect(mocks.scores).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Your best models" }));
    expect(await screen.findByText("Model A")).toBeInTheDocument();
    expect(screen.getByText("Wins 64% · 25 picks")).toBeInTheDocument();
    expect(screen.getByText("Model B")).toBeInTheDocument();
    expect(screen.getByText("Wins 50% · 3 picks")).toBeInTheDocument();
    expect(
      screen.getByText("Early results · fewer than 10 picks"),
    ).toBeInTheDocument();
    expect(mocks.scores).toHaveBeenCalledWith({ projectId: "project" });
  });

  it("shows how to start when there are no picks", async () => {
    mocks.scores.mockResolvedValue({
      ok: true,
      value: { models: [], minimumComparisons: 10 },
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Your best models" }));
    expect(
      await screen.findByText("Compare ads to find your best models."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Early results/)).not.toBeInTheDocument();
  });

  it("retries a load error", async () => {
    mocks.scores.mockResolvedValueOnce({
      ok: false,
      error: { message: "Unavailable" },
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Your best models" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Model A")).toBeInTheDocument();
  });

  it("reloads when reopened after comparisons change", async () => {
    mount();
    const trigger = screen.getByRole("button", { name: "Your best models" });
    fireEvent.click(trigger);
    await screen.findByText("Wins 64% · 25 picks");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    mocks.scores.mockResolvedValue({
      ok: true,
      value: {
        models: [
          {
            model: "model-a",
            comparisons: 26,
            winRate: 0.65,
            elo: 1045,
            provisional: false,
          },
        ],
        minimumComparisons: 10,
      },
    });
    fireEvent.click(trigger);
    expect(await screen.findByText("Wins 65% · 26 picks")).toBeInTheDocument();
    expect(screen.queryByText(/Early results/)).not.toBeInTheDocument();
  });
});
