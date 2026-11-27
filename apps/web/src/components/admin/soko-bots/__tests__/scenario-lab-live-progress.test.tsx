import { act, fireEvent, render, screen } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";

const {
  listRunsMock,
  setVersionMock,
  startTurnMock,
  judgeMock,
  simulateMock,
  ingestMock,
} = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  setVersionMock: vi.fn(),
  startTurnMock: vi.fn(),
  judgeMock: vi.fn(),
  simulateMock: vi.fn(async () => ({ ok: true, value: { turnId: "turn_1" } })),
  ingestMock: vi.fn(async () => ({ ok: true, value: { turnId: "turn_1" } })),
}));

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
  simulateSokoBotTaskEventAction: (...args: unknown[]) =>
    simulateMock(...(args as [])),
  runSokoBotLabIngestAction: (...args: unknown[]) =>
    ingestMock(...(args as [])),
  startSokoBotTurnAction: (...args: unknown[]) => startTurnMock(...args),
}));

import type { SokoBotVersion } from "@sokosumi/core-client";
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

function turn(status: string, toolCalls: unknown[] = []) {
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

function makeWrapper() {
  const NuqsWrapper = withNuqsTestingAdapter({});
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestQueryProvider>
        <NuqsWrapper>{children}</NuqsWrapper>
      </TestQueryProvider>
    );
  };
}

// A run asleep between two polls, a batch and a pending fetch all outlive a
// test that ends first, and then set state on a torn-down environment. So
// every test finishes what it starts: `finish()` lets the turn complete and
// the clock run until nothing is waiting.
let turnStatus = "RUNNING";
let turnToolCalls: (url: string) => unknown[] = () => [];

function stubTurnFetch() {
  const fetchMock = vi.fn(async (url: string) =>
    Response.json({ turn: turn(turnStatus, turnToolCalls(url)) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function finish() {
  turnStatus = "COMPLETED";
  for (let i = 0; i < 10 && vi.getTimerCount() > 0; i++) await flush(5_000);
}

function renderLab() {
  return render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
    wrapper: makeWrapper(),
  });
}

async function clickRun(name: string, index = 0) {
  await flush();
  const buttons = screen.getAllByRole("button", { name });
  fireEvent.click(buttons[index] as HTMLElement);
  await flush();
}

describe("ScenarioLab live progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    turnStatus = "RUNNING";
    turnToolCalls = () => [];
    listRunsMock.mockResolvedValue({ ok: true, value: [] });
    setVersionMock.mockResolvedValue({ ok: true, value: { id: "bot" } });
    judgeMock.mockResolvedValue({ ok: true, value: {} });
    startTurnMock.mockResolvedValue({ ok: true, value: { turnId: "turn_1" } });
  });

  afterEach(() => {
    // The rule these tests follow: nothing is left asleep at the end.
    const pending = vi.getTimerCount();
    vi.useRealTimers();
    expect(pending).toBe(0);
  });

  it("shows the step the assistant is on while the turn runs", async () => {
    // Still running with one finished call and one in flight: what a reader
    // used to have no way of seeing.
    turnToolCalls = () => [
      { id: "c1", capability: "create_task", status: "COMPLETED" },
      { id: "c2", capability: "create_schedule", status: "RUNNING" },
    ];
    stubTurnFetch();
    const { unmount } = renderLab();

    // Exactly "run": the page also has runAll and runAllVersions, and the
    // first scenario is a plain prompt rather than a simulated trigger.
    await clickRun("run");

    expect(screen.getByText("create_schedule")).toBeInTheDocument();
    expect(screen.getByText("create_task")).toBeInTheDocument();
    // The route it took, without opening the turn.
    expect(screen.getByText("liveRoute")).toBeInTheDocument();
    await finish();
    unmount();
  });

  it("shows the failed step's diagnostic from the admin turn read", async () => {
    const adminUrl = "/api/admin/soko-bots/turns/turn_1";
    const diagnostic = "Provider rejected the tool call (HTTP 429)";
    turnToolCalls = (url) => [
      {
        id: "call-1",
        capability: "read_email",
        status: "FAILED",
        errorDetail: url === adminUrl ? diagnostic : null,
      },
    ];
    const fetchMock = stubTurnFetch();
    const { unmount } = renderLab();
    await clickRun("run");

    expect(screen.getByText("read_email")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(adminUrl, expect.anything());
    expect(screen.getByText(diagnostic)).toBeInTheDocument();
    await finish();
    unmount();
  });

  it("stops polling the turn once the lab closes", async () => {
    const fetchMock = stubTurnFetch();
    const { unmount } = renderLab();
    await clickRun("run");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    await flush(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["runAll", 0],
    ["runAllVersions", 1],
  ])(
    "starts nothing more of a %s batch once the lab closes",
    async (button, versionChanges) => {
      const fetchMock = stubTurnFetch();
      const { unmount } = renderLab();
      await clickRun(button);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      unmount();
      await flush(5_000);
      // Only the first scenario's turn, which was running when the lab closed.
      expect(startTurnMock).toHaveBeenCalledTimes(1);
      expect(simulateMock).not.toHaveBeenCalled();
      expect(ingestMock).not.toHaveBeenCalled();
      expect(setVersionMock).toHaveBeenCalledTimes(versionChanges);
    },
  );

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
    stubTurnFetch();
    const { unmount } = renderLab();
    await clickRun("run");

    expect(screen.getByText("previousRun")).toBeInTheDocument();
    await finish();
    unmount();
  });
});
