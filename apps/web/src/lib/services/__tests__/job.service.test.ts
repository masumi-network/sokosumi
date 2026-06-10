import { InputType } from "@sokosumi/masumi/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createDemoJobCoreMock = vi.fn();
const moveJobToWorkspaceCoreMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    createDemoJob: (...args: unknown[]) => createDemoJobCoreMock(...args),
    moveJobToWorkspace: (...args: unknown[]) =>
      moveJobToWorkspaceCoreMock(...args),
  },
}));

function buildStartInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user_123",
    organizationId: "org_123",
    agentId: "agent_123",
    inputData: {
      prompt: "hello",
    },
    inputSchema: {
      input_data: [
        {
          id: "prompt",
          type: InputType.STRING,
          name: "Prompt",
        },
      ],
    },
    maxAcceptedCents: BigInt(10),
    ...overrides,
  } as never;
}

describe("jobService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates demo jobs through the core client", async () => {
    createDemoJobCoreMock.mockResolvedValue({ data: { id: "job_demo" } });

    const { jobService } = await import("../job.service");

    const result = await jobService.startDemoJob(
      buildStartInput({ organizationId: null }),
      { result: "demo result" } as never,
    );

    expect(createDemoJobCoreMock).toHaveBeenCalledWith("agent_123", {
      inputData: { prompt: "hello" },
      inputSchema: {
        input_data: [
          {
            id: "prompt",
            type: InputType.STRING,
            name: "Prompt",
          },
        ],
      },
      result: "demo result",
    });
    expect(result).toEqual({ id: "job_demo" });
  });

  it("rejects demo jobs whose input cannot be sent to core (e.g. File values)", async () => {
    const { jobService } = await import("../job.service");

    await expect(
      jobService.startDemoJob(
        buildStartInput({
          inputData: { attachment: new File(["x"], "x.txt") },
        }),
        { result: "demo result" } as never,
      ),
    ).rejects.toThrow();
    expect(createDemoJobCoreMock).not.toHaveBeenCalled();
  });

  it("moves standalone jobs through the core client", async () => {
    moveJobToWorkspaceCoreMock.mockResolvedValue({
      data: {
        id: "job_123",
      },
    });

    const { jobService } = await import("../job.service");

    const result = await jobService.moveJobToWorkspace("job_123", "org_456");

    expect(moveJobToWorkspaceCoreMock).toHaveBeenCalledWith("job_123", {
      organizationId: "org_456",
    });
    expect(result).toEqual({
      id: "job_123",
    });
  });
});
