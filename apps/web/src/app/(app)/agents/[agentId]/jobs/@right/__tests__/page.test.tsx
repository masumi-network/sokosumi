import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCachedMyJobsMock = vi.fn();
const getCoreAgentByIdMock = vi.fn();
const getTranslationsMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const createJobModalTriggerMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("@/app/agents/[agentId]/jobs/_lib/get-cached-my-jobs", () => ({
  getCachedMyJobs: (...args: unknown[]) => getCachedMyJobsMock(...args),
}));

vi.mock("@/lib/agents/core-loaders", () => ({
  getCoreAgentById: (...args: unknown[]) => getCoreAgentByIdMock(...args),
}));

vi.mock("@/components/create-job-modal", () => ({
  CreateJobModalTrigger: (props: unknown) => {
    createJobModalTriggerMock(props);
    return <div data-testid="create-job-trigger" />;
  },
}));

describe("RightSectionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTranslationsMock.mockResolvedValue((key: string) => key);
  });

  it("stays on the agent jobs list and prompts to select a job when jobs exist", async () => {
    getCoreAgentByIdMock.mockResolvedValue({ id: "agent-1", name: "Agent" });
    getCachedMyJobsMock.mockResolvedValue({
      jobs: [{ id: "job-1" }],
      nextCursor: null,
    });

    const { default: RightSectionPage } = await import("../page");

    render(
      await RightSectionPage({
        params: Promise.resolve({ agentId: "agent-1" }),
      }),
    );

    expect(screen.getByText("selectJob")).toBeInTheDocument();
    expect(createJobModalTriggerMock).not.toHaveBeenCalled();
  });

  it("shows empty state when the agent has no jobs", async () => {
    getCoreAgentByIdMock.mockResolvedValue({ id: "agent-1", name: "Agent" });
    getCachedMyJobsMock.mockResolvedValue({
      jobs: [],
      nextCursor: null,
    });

    const { default: RightSectionPage } = await import("../page");

    render(
      await RightSectionPage({
        params: Promise.resolve({ agentId: "agent-1" }),
      }),
    );

    expect(screen.getByText("noExecutedJobs")).toBeInTheDocument();
    expect(screen.getByTestId("create-job-trigger")).toBeInTheDocument();
  });
});
