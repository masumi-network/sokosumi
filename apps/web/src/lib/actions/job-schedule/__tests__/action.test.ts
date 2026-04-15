import { InputType } from "@sokosumi/masumi/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@/lib/auth/auth";

import { JobScheduleType } from "@/lib/types/job";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler(params),
}));

const createMock = vi.fn();
const handleInputDataFileUploadsMock = vi.fn();
const upsertWorkspaceForContextMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  jobScheduleRepository: {
    create: createMock,
  },
  workspaceRepository: {
    upsertWorkspaceForContext: upsertWorkspaceForContextMock,
  },
}));

vi.mock("@/lib/actions/job/utils", () => ({
  handleInputDataFileUploads: handleInputDataFileUploadsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("createSchedule", () => {
  function buildSession(activeOrganizationId: null | string): Session {
    return {
      user: {
        id: "user_123",
      },
      session: {
        activeOrganizationId,
      },
    } as Session;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    upsertWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    createMock.mockResolvedValue({
      id: "schedule_123",
    });
  });

  it("resolves and persists workspace placement on schedule creation", async () => {
    const { createSchedule } = await import("../action");

    const result = await createSchedule({
      session: {
        ...buildSession("org_123"),
      },
      input: {
        agentId: "agent_123",
        inputSchema: {
          input_data: [
            {
              id: "prompt",
              type: InputType.STRING,
              name: "Prompt",
            },
          ],
        },
        inputData: {
          prompt: "hello",
        },
        maxAcceptedCents: BigInt(10),
      },
      scheduleSelection: {
        mode: JobScheduleType.ONE_TIME,
        timezone: "UTC",
        oneTimeLocalIso: "2026-04-02T10:00:00.000Z",
      },
    });

    expect(result).toEqual({
      ok: true,
      data: {
        jobId: "",
        scheduleId: "schedule_123",
      },
    });
    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      {},
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: {
          connect: {
            id: "11111111-1111-7111-8111-111111111111",
          },
        },
      }),
      {},
    );
  });

  it("resolves the personal workspace when no active organization exists", async () => {
    const { createSchedule } = await import("../action");

    await createSchedule({
      session: {
        ...buildSession(null),
      },
      input: {
        agentId: "agent_123",
        inputSchema: {
          input_data: [
            {
              id: "prompt",
              type: InputType.STRING,
              name: "Prompt",
            },
          ],
        },
        inputData: {
          prompt: "hello",
        },
        maxAcceptedCents: BigInt(10),
      },
      scheduleSelection: {
        mode: JobScheduleType.ONE_TIME,
        timezone: "UTC",
        oneTimeLocalIso: "2026-04-02T10:00:00.000Z",
      },
    });

    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      null,
      {},
    );
  });
});
