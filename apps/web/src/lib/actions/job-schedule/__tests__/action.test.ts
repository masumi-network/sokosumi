import { beforeEach, describe, expect, it, vi } from "vitest";

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
const resolveWorkspaceForContextMock = vi.fn();

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    resolveWorkspaceForContext: resolveWorkspaceForContextMock,
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  jobScheduleRepository: {
    create: createMock,
  },
}));

vi.mock("@/lib/actions/job/utils", () => ({
  handleInputDataFileUploads: handleInputDataFileUploadsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("createSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWorkspaceForContextMock.mockResolvedValue({
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
        user: {
          id: "user_123",
        },
        session: {
          activeOrganizationId: "org_123",
        },
      },
      input: {
        agentId: "agent_123",
        inputSchema: {
          input_data: [
            {
              id: "prompt",
              type: "string",
              name: "Prompt",
            },
          ],
        },
        inputData: {
          prompt: "hello",
        },
        maxAcceptedCents: 10n,
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
    expect(resolveWorkspaceForContextMock).toHaveBeenCalledWith(
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
        user: {
          id: "user_123",
        },
        session: {
          activeOrganizationId: null,
        },
      },
      input: {
        agentId: "agent_123",
        inputSchema: {
          input_data: [
            {
              id: "prompt",
              type: "string",
              name: "Prompt",
            },
          ],
        },
        inputData: {
          prompt: "hello",
        },
        maxAcceptedCents: 10n,
      },
      scheduleSelection: {
        mode: JobScheduleType.ONE_TIME,
        timezone: "UTC",
        oneTimeLocalIso: "2026-04-02T10:00:00.000Z",
      },
    });

    expect(resolveWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      null,
      {},
    );
  });
});
