import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarErasureBlockedError } from "./calendar-erasure";
import { prepareOrganizationForDeletion } from "./organization-deletion";

const {
  eraseWorkspaceCalendarDataMock,
  evaluateOrganizationDeletionMock,
  lockCalendarErasureUserMock,
  lockWorkspaceCalendarForErasureMock,
  lockCalendarScopeMock,
  throwIfOrganizationDeletionBlockedMock,
} = vi.hoisted(() => ({
  eraseWorkspaceCalendarDataMock: vi.fn(),
  evaluateOrganizationDeletionMock: vi.fn(),
  lockCalendarErasureUserMock: vi.fn(),
  lockWorkspaceCalendarForErasureMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  throwIfOrganizationDeletionBlockedMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-erasure", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/calendar-erasure")>();
  return {
    ...actual,
    eraseWorkspaceCalendarData: eraseWorkspaceCalendarDataMock,
    lockCalendarErasureUser: lockCalendarErasureUserMock,
    lockWorkspaceCalendarForErasure: lockWorkspaceCalendarForErasureMock,
  };
});

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
}));

vi.mock("@/helpers/deletion-evaluate", () => ({
  evaluateOrganizationDeletion: evaluateOrganizationDeletionMock,
  throwIfOrganizationDeletionBlocked: throwIfOrganizationDeletionBlockedMock,
}));

function createPrisma() {
  const queryRaw = vi.fn();
  const workspaceFindUnique = vi.fn();
  const organizationDeleteMany = vi.fn();
  const transaction = vi.fn(async (callback) =>
    callback({
      $queryRaw: queryRaw,
      workspace: { findUnique: workspaceFindUnique },
      organization: { deleteMany: organizationDeleteMany },
    }),
  );

  return {
    prisma: { $transaction: transaction },
    queryRaw,
    workspaceFindUnique,
    organizationDeleteMany,
  };
}

describe("prepareOrganizationForDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarErasureUserMock.mockResolvedValue(true);
    lockCalendarScopeMock.mockResolvedValue(true);
    evaluateOrganizationDeletionMock.mockResolvedValue({ blockers: [] });
    eraseWorkspaceCalendarDataMock.mockResolvedValue(undefined);
    lockWorkspaceCalendarForErasureMock.mockResolvedValue(true);
  });

  it("evaluates, erases, and deletes under canonical parent-first locks", async () => {
    const { prisma, queryRaw, workspaceFindUnique, organizationDeleteMany } =
      createPrisma();
    queryRaw.mockResolvedValue([{ id: "org-1", stripeCustomerId: "cus_123" }]);
    workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });
    organizationDeleteMany.mockResolvedValue({ count: 1 });

    await expect(
      prepareOrganizationForDeletion("org-1", "user-1", prisma as never),
    ).resolves.toBe("cus_123");

    expect(lockCalendarErasureUserMock).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
    );
    expect(
      (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?"),
    ).toMatch(/FROM "organization"[\s\S]*WHERE id = \?[\s\S]*FOR UPDATE/);
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual(["org-1"]);
    expect(workspaceFindUnique).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { id: true },
    });
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.any(Object),
      "workspace-1",
      [],
    );
    expect(evaluateOrganizationDeletionMock).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      expect.any(Object),
    );
    expect(eraseWorkspaceCalendarDataMock).toHaveBeenCalledWith(
      expect.any(Object),
      "workspace-1",
    );
    expect(organizationDeleteMany).toHaveBeenCalledWith({
      where: { id: "org-1" },
    });

    const orderedMocks = [
      lockCalendarErasureUserMock,
      queryRaw,
      workspaceFindUnique,
      lockCalendarScopeMock,
      evaluateOrganizationDeletionMock,
      throwIfOrganizationDeletionBlockedMock,
      lockWorkspaceCalendarForErasureMock,
      eraseWorkspaceCalendarDataMock,
      organizationDeleteMany,
    ];
    expect(
      orderedMocks.map((mock) => mock.mock.invocationCallOrder[0]),
    ).toEqual(
      [...orderedMocks]
        .map((mock) => mock.mock.invocationCallOrder[0])
        .sort((left, right) => left - right),
    );
  });

  it("maps calendar payment blockers to the organization deletion contract", async () => {
    const { prisma, queryRaw, workspaceFindUnique, organizationDeleteMany } =
      createPrisma();
    queryRaw.mockResolvedValue([{ id: "org-1", stripeCustomerId: null }]);
    workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });
    lockWorkspaceCalendarForErasureMock.mockRejectedValue(
      new CalendarErasureBlockedError("task_payment_unresolved"),
    );

    let caught: unknown;
    try {
      await prepareOrganizationForDeletion("org-1", "user-1", prisma as never);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(APIError);
    expect((caught as APIError).status).toBe("BAD_REQUEST");
    expect((caught as APIError).body?.code).toBe(
      "ORGANIZATION_DELETION_TASK_PAYMENT_BLOCKED",
    );
    expect(organizationDeleteMany).not.toHaveBeenCalled();
  });
});
