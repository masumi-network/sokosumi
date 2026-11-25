import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { Activity, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
      wrapper: makeWrapper(),
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

  it("shows the failed step's diagnostic from the admin turn read", async () => {
    startTurnMock.mockResolvedValue({ ok: true, value: { turnId: "turn_1" } });
    const adminUrl = "/api/admin/soko-bots/turns/turn_1";
    const diagnostic = "Provider rejected the tool call (HTTP 429)";
    const fetchMock = vi.fn(async (url: string) =>
      Response.json({
        turn: turn("RUNNING", [
          {
            id: "call-1",
            capability: "read_email",
            status: "FAILED",
            errorDetail: url === adminUrl ? diagnostic : null,
          },
        ]),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
      wrapper: makeWrapper(),
    });
    const [runButton] = await screen.findAllByRole("button", { name: "run" });
    fireEvent.click(runButton);

    await screen.findByText("read_email");
    expect(fetchMock).toHaveBeenCalledWith(adminUrl, expect.anything());
    expect(screen.getByText(diagnostic)).toBeInTheDocument();
  });

  it("stops polling the turn once the lab closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout"] });
    startTurnMock.mockResolvedValue({ ok: true, value: { turnId: "turn_1" } });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ turn: turn("RUNNING", []) }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { unmount } = render(
        <ScenarioLab versionId="v11" versions={VERSIONS} />,
        { wrapper: makeWrapper() },
      );
      const runButtons = await screen.findAllByRole("button", { name: "run" });
      fireEvent.click(runButtons[0] as HTMLElement);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      unmount();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["runAll", 0],
    ["runAllVersions", 1],
  ])(
    "starts nothing more of a %s batch once the lab closes",
    async (button, versionChanges) => {
      vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout"] });
      startTurnMock.mockResolvedValue({
        ok: true,
        value: { turnId: "turn_1" },
      });
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ turn: turn("RUNNING", []) }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const { unmount } = render(
          <ScenarioLab versionId="v11" versions={VERSIONS} />,
          { wrapper: makeWrapper() },
        );
        fireEvent.click(await screen.findByRole("button", { name: button }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        unmount();
        await vi.advanceTimersByTimeAsync(5_000);
        // Only the first scenario's turn, which was running when the lab closed.
        expect(startTurnMock).toHaveBeenCalledTimes(1);
        expect(simulateMock).not.toHaveBeenCalled();
        expect(ingestMock).not.toHaveBeenCalled();
        expect(setVersionMock).toHaveBeenCalledTimes(versionChanges);
      } finally {
        vi.useRealTimers();
      }
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
    startTurnMock.mockResolvedValue({ ok: true, value: { turnId: "turn_1" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ turn: turn("RUNNING", []) }),
      })),
    );

    render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
      wrapper: makeWrapper(),
    });

    // Exactly "run": the page also has runAll and runAllVersions, and the
    // first scenario is a plain prompt rather than a simulated trigger.
    const runButtons = await screen.findAllByRole("button", { name: "run" });
    fireEvent.click(runButtons[0] as HTMLElement);

    await waitFor(() =>
      expect(screen.getByText("previousRun")).toBeInTheDocument(),
    );
  });

  it.each([
    ["network error", () => Promise.reject(new TypeError("network down"))],
    [
      "invalid JSON",
      () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new SyntaxError("bad json")),
        }),
    ],
  ])(
    "releases controls on a poll %s instead of looping until timeout",
    async (_label, fetchImpl) => {
      startTurnMock.mockResolvedValue({
        ok: true,
        value: { turnId: "turn_1" },
      });
      const fetchMock = vi.fn(fetchImpl);
      vi.stubGlobal("fetch", fetchMock);

      render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
        wrapper: makeWrapper(),
      });

      const [runButton] = await screen.findAllByRole("button", { name: "run" });
      fireEvent.click(runButton);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(runButton).toBeEnabled());
      expect(screen.queryByText("timeout")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not report a timeout when an Activity hide aborts the watcher before reveal", async () => {
    startTurnMock.mockResolvedValue({ ok: true, value: { turnId: "turn_1" } });
    const pendingFetch = Promise.withResolvers<Response>();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      capturedSignal = init?.signal;
      return pendingFetch.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    const Wrapper = makeWrapper();
    const { rerender } = render(
      <Wrapper>
        <Activity mode="visible">
          <ScenarioLab versionId="v11" versions={VERSIONS} />
        </Activity>
      </Wrapper>,
    );

    const [runButton] = await screen.findAllByRole("button", { name: "run" });
    fireEvent.click(runButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(
      <Wrapper>
        <Activity mode="hidden">
          <ScenarioLab versionId="v11" versions={VERSIONS} />
        </Activity>
      </Wrapper>,
    );
    expect(capturedSignal?.aborted).toBe(true);

    rerender(
      <Wrapper>
        <Activity mode="visible">
          <ScenarioLab versionId="v11" versions={VERSIONS} />
        </Activity>
      </Wrapper>,
    );

    pendingFetch.reject(new DOMException("Aborted", "AbortError"));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "run" })[0]).toBeEnabled(),
    );
    expect(screen.queryByText("timeout")).not.toBeInTheDocument();
  });
});
