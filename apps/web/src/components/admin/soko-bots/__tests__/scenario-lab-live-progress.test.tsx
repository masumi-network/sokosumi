import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listRunsMock, setVersionMock, startTurnMock, judgeMock } = vi.hoisted(
  () => ({
    listRunsMock: vi.fn(),
    setVersionMock: vi.fn(),
    startTurnMock: vi.fn(),
    judgeMock: vi.fn(),
  }),
);

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
    number: (value: number) => String(value),
    relativeTime: () => "just now",
  }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  judgeSokoBotLabTurnAction: (...args: unknown[]) => judgeMock(...args),
  listSokoBotLabRunsAction: (...args: unknown[]) => listRunsMock(...args),
  setSokoBotVersionAction: (...args: unknown[]) => setVersionMock(...args),
  simulateSokoBotTaskEventAction: vi.fn(async () => ({
    ok: true,
    value: { turnId: "turn_1" },
  })),
  runSokoBotLabIngestAction: vi.fn(async () => ({
    ok: true,
    value: { turnId: "turn_1" },
  })),
  startSokoBotTurnAction: (...args: unknown[]) => startTurnMock(...args),
}));

import type { SokoBotVersion } from "@/lib/clients/generated/core";
import { ScenarioLab } from "../scenario-lab.client";

const VERSIONS: SokoBotVersion[] = [
  {
    id: "v11",
    name: "Version 11",
    createdAt: "2026-08-01",
    summary: "Current version",
    model: "model/v11",
    skills: [],
    capabilities: null,
    inferenceRegion: null,
    systemPrompt: "Version 11 prompt",
  },
];

function turn(status: string, toolCalls: unknown[]) {
  return {
    id: "turn_1",
    status,
    route: "DELEGATE_TASK",
    toolCalls,
    finalAnswer: null,
    events: [],
    delegations: [],
    decisions: [],
  };
}

describe("ScenarioLab live progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRunsMock.mockResolvedValue({ ok: true, value: [] });
    setVersionMock.mockResolvedValue({ ok: true, value: { id: "bot" } });
    judgeMock.mockResolvedValue({ ok: true, value: {} });
  });

  it("shows the step the assistant is on while the turn runs", async () => {
    startTurnMock.mockResolvedValue({ ok: true, value: { turnId: "turn_1" } });
    // Two polls: still running with one finished call and one in flight, then
    // settled. The first is what a reader used to have no way of seeing.
    const running = turn("RUNNING", [
      { id: "c1", capability: "create_task", status: "COMPLETED" },
      { id: "c2", capability: "create_schedule", status: "RUNNING" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ turn: running }),
      })),
    );

    render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
      wrapper: withNuqsTestingAdapter({}),
    });

    // Exactly "run": the page also has runAll and runAllVersions, and the
    // first scenario is a plain prompt rather than a simulated trigger.
    const runButtons = await screen.findAllByRole("button", { name: "run" });
    fireEvent.click(runButtons[0] as HTMLElement);

    await waitFor(() =>
      expect(screen.getByText("create_schedule")).toBeInTheDocument(),
    );
    expect(screen.getByText("create_task")).toBeInTheDocument();
    // The route it took, without opening the turn.
    expect(screen.getByText("liveRoute")).toBeInTheDocument();
  });

  it("names the old result as previous so it is not read as the live one", async () => {
    listRunsMock.mockResolvedValue({
      ok: true,
      value: [
        {
          scenarioId: "delegate-with-daily-checkin",
          turnId: "turn_0",
          versionId: "v11",
          createdAt: new Date().toISOString(),
          passed: 7,
          total: 7,
          durationMs: 11_000,
          costUsd: 0.02,
          checks: [],
          judge: null,
          judgeModel: null,
        },
      ],
    });
    startTurnMock.mockResolvedValue({ ok: true, value: { turnId: "turn_1" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ turn: turn("RUNNING", []) }),
      })),
    );

    render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
      wrapper: withNuqsTestingAdapter({}),
    });

    // Exactly "run": the page also has runAll and runAllVersions, and the
    // first scenario is a plain prompt rather than a simulated trigger.
    const runButtons = await screen.findAllByRole("button", { name: "run" });
    fireEvent.click(runButtons[0] as HTMLElement);

    await waitFor(() =>
      expect(screen.getByText("previousRun")).toBeInTheDocument(),
    );
  });
});
