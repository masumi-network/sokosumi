import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";

const { listRunsMock, setVersionMock } = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  setVersionMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
    number: (value: number) => String(value),
  }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  judgeSokoBotLabTurnAction: vi.fn(),
  listSokoBotLabRunsAction: (...args: unknown[]) => listRunsMock(...args),
  setSokoBotVersionAction: (...args: unknown[]) => setVersionMock(...args),
  simulateSokoBotTaskEventAction: vi.fn(),
  startSokoBotTurnAction: vi.fn(),
}));

import type { SokoBot, SokoBotVersion } from "@sokosumi/core-client";
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
  {
    id: "v12-operator",
    name: "Operator",
    createdAt: "2026-08-27",
    summary: "Candidate version",
    model: "model/v12",
    skills: [],
    capabilities: [],
    inferenceRegion: "eu",
    systemPrompt: "Version 12 prompt",
  },
];

const BOT: SokoBot = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  name: "Admin bot",
  avatarSeed: null,
  personalityTone: null,
  personalityDetail: null,
  personalityStyle: null,
  status: "IDLE",
  runtimeVersion: null,
  lastSandboxStatus: null,
  memoryVersion: 1,
  memoryHash: null,
  lastActivityAt: null,
  lastTurnAt: null,
  lastSucceededAt: null,
  lastFailedAt: null,
  consecutiveTurnFailures: 0,
  versionId: "v12-operator",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-27T00:00:00Z"),
};

function makeWrapper(
  options: Parameters<typeof withNuqsTestingAdapter>[0] = {},
) {
  const NuqsWrapper = withNuqsTestingAdapter(options);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestQueryProvider>
        <NuqsWrapper>{children}</NuqsWrapper>
      </TestQueryProvider>
    );
  };
}

describe("ScenarioLab version URL state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRunsMock.mockResolvedValue({ ok: true, value: [] });
    setVersionMock.mockResolvedValue({ ok: true, value: BOT });
  });

  it("applies a valid deep-linked version before displaying it as active", async () => {
    render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
      wrapper: makeWrapper({
        searchParams: "?version=v12-operator",
      }),
    });

    await waitFor(() =>
      expect(setVersionMock).toHaveBeenCalledWith({
        versionId: "v12-operator",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Operator" })).toHaveClass(
        "border-foreground",
      ),
    );
    expect(screen.getByText("allTools")).toBeInTheDocument();
  });

  it("updates URL state only after Core accepts a picker change", async () => {
    const onUrlUpdate = vi.fn();
    render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
      wrapper: makeWrapper({ onUrlUpdate }),
    });
    const candidate = await screen.findByRole("button", { name: "Operator" });

    fireEvent.click(candidate);

    await waitFor(() => expect(setVersionMock).toHaveBeenCalled());
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const event = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(event?.searchParams.get("version")).toBe("v12-operator");
  });

  it("shows the prompt row only when Core sends the prompt (SOKD-488)", async () => {
    const withoutPrompt = VERSIONS.map(
      ({ systemPrompt: _, ...version }) => version,
    );
    const { unmount } = render(
      <ScenarioLab versionId="v11" versions={withoutPrompt} />,
      { wrapper: makeWrapper() },
    );
    await screen.findByRole("button", { name: "Operator" });
    expect(screen.queryByText("overviewPrompt")).not.toBeInTheDocument();
    unmount();

    render(<ScenarioLab versionId="v11" versions={VERSIONS} />, {
      wrapper: makeWrapper(),
    });
    expect(await screen.findByText("overviewPrompt")).toBeInTheDocument();
  });
});
