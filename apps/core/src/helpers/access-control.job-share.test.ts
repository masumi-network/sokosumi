import { type Prisma, TaskStatus } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";
import type {
  CoworkerAuthenticationContext,
  SokoBotAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import { requireJobShareCollaboration } from "./access-control.job-share";

const { requireJobCollaborationMock } = vi.hoisted(() => ({
  requireJobCollaborationMock: vi.fn(),
}));

// Only the agent branch is mocked. The human branch below runs the real
// `requireJobRead`, so its where clause is the assertion, not a stub.
vi.mock("./access-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access-control")>();

  return {
    ...actual,
    requireJobCollaboration: requireJobCollaborationMock,
  };
});

const organizationWorkspaceId = "11111111-1111-7111-8111-111111111111";
const personalWorkspaceId = "22222222-2222-7222-8222-222222222222";

function createTransactionClient() {
  return {
    job: {
      findFirst: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
    },
    sokoBot: {
      findFirst: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

const memberAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "member_456",
  organizationId: "org_123",
  role: "user",
};

const organizationWorkspaceContext: WorkspaceContext = {
  workspaceId: organizationWorkspaceId,
  userId: null,
  organizationId: "org_123",
};

const personalWorkspaceContext: WorkspaceContext = {
  workspaceId: personalWorkspaceId,
  userId: "member_456",
  organizationId: null,
};

function varsFor(
  workspaceContext: WorkspaceContext | null,
  authContext:
    | UserAuthenticationContext
    | SokoBotAuthenticationContext
    | CoworkerAuthenticationContext = memberAuthContext,
): EnvVariables["Variables"] {
  return {
    isAuthenticated: true,
    authContext,
    workspaceContext,
  };
}

describe("requireJobShareCollaboration", () => {
  it("scopes a member to the active workspace without an ownership filter", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      ownerId: "other_member_789",
      taskId: null,
    } as never);

    await expect(
      requireJobShareCollaboration(
        varsFor(organizationWorkspaceContext),
        "job_123",
        tx,
      ),
    ).resolves.toMatchObject({ id: "job_123" });

    // The whole policy is in this where clause: workspace, never ownerId.
    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_123", workspaceId: organizationWorkspaceId },
    });
  });

  it("denies a job outside the active workspace", async () => {
    const tx = createTransactionClient();
    // A job in another organization's workspace does not match the filter.
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobShareCollaboration(
        varsFor(organizationWorkspaceContext),
        "job_other_org",
        tx,
      ),
    ).rejects.toThrow("Job not found");
  });

  it("scopes a personal workspace to that workspace only", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce(null);

    await expect(
      requireJobShareCollaboration(
        varsFor(personalWorkspaceContext),
        "job_of_another_user",
        tx,
      ),
    ).rejects.toThrow("Job not found");

    expect(tx.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job_of_another_user", workspaceId: personalWorkspaceId },
    });
  });

  it("denies a member with no workspace context", async () => {
    const tx = createTransactionClient();

    await expect(
      requireJobShareCollaboration(varsFor(null), "job_123", tx),
    ).rejects.toThrow("Workspace is missing");

    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });

  it("denies a job whose parent task is parked", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      ownerId: "other_member_789",
      taskId: "tsk_123",
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      status: TaskStatus.GRANT_PENDING,
    } as never);

    await expect(
      requireJobShareCollaboration(
        varsFor(organizationWorkspaceContext),
        "job_123",
        tx,
      ),
    ).rejects.toThrow();
  });

  it("allows a job whose parent task is not parked", async () => {
    const tx = createTransactionClient();
    vi.mocked(tx.job.findFirst).mockResolvedValueOnce({
      id: "job_123",
      ownerId: "other_member_789",
      taskId: "tsk_123",
    } as never);
    vi.mocked(tx.task.findFirst).mockResolvedValueOnce({
      status: TaskStatus.COMPLETED,
    } as never);

    await expect(
      requireJobShareCollaboration(
        varsFor(organizationWorkspaceContext),
        "job_123",
        tx,
      ),
    ).resolves.toMatchObject({ id: "job_123" });
  });
  it("leaves Soko Bot access to the existing collaboration rules", async () => {
    const tx = createTransactionClient();
    const sokoBotAuthContext = {
      actor: "sokoBot",
      sokoBotId: "bot_123",
      userId: "member_456",
      organizationId: "org_123",
      workspaceId: organizationWorkspaceId,
    } as unknown as SokoBotAuthenticationContext;

    requireJobCollaborationMock.mockResolvedValueOnce({ id: "job_123" });

    await expect(
      requireJobShareCollaboration(
        varsFor(organizationWorkspaceContext, sokoBotAuthContext),
        "job_123",
        tx,
      ),
    ).resolves.toMatchObject({ id: "job_123" });

    // SOK-1030 widens human access only. Agent policy is unchanged.
    expect(requireJobCollaborationMock).toHaveBeenCalledWith(
      sokoBotAuthContext,
      "job_123",
      tx,
    );
    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });
  it("leaves coworker access to the existing collaboration rules", async () => {
    const tx = createTransactionClient();
    const coworkerAuthContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: {
        userId: "member_456",
        organizationId: "org_123",
      },
    };

    requireJobCollaborationMock.mockResolvedValueOnce({ id: "job_123" });

    await expect(
      requireJobShareCollaboration(
        varsFor(organizationWorkspaceContext, coworkerAuthContext),
        "job_123",
        tx,
      ),
    ).resolves.toMatchObject({ id: "job_123" });

    // A coworker still needs the tasks capability and a task assigned to it.
    expect(requireJobCollaborationMock).toHaveBeenCalledWith(
      coworkerAuthContext,
      "job_123",
      tx,
    );
    expect(tx.job.findFirst).not.toHaveBeenCalled();
  });
});
