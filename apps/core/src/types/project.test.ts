import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoworkerTaskAccessSql } from "@/helpers/task-visibility";
import { hasGrantedWorkspaceAccess } from "@/helpers/vendor-grants";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  humanProjectReaderVisibility,
  resolveProjectReaderAccess,
  resolveProjectReaderVisibility,
} from "./project";

vi.mock("@/helpers/vendor-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/vendor-grants")>();
  return { ...actual, hasGrantedWorkspaceAccess: vi.fn(async () => false) };
});

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

const USER_AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
};

function sqlValues(sql: { values: unknown[] }): unknown[] {
  return sql.values;
}

describe("resolveProjectReaderAccess", () => {
  beforeEach(() => {
    vi.mocked(hasGrantedWorkspaceAccess).mockReset();
    vi.mocked(hasGrantedWorkspaceAccess).mockResolvedValue(false);
  });

  it("skips the grant lookup for a human reader", async () => {
    const access = await resolveProjectReaderAccess(USER_AUTH, WORKSPACE_ID);

    expect(hasGrantedWorkspaceAccess).not.toHaveBeenCalled();
    expect(access.prismaWhere).toEqual(
      humanProjectReaderVisibility(USER_AUTH.userId),
    );
    expect(sqlValues(access.sqlWhere.task)).toContain(USER_AUTH.userId);
  });

  it("looks up the coworker workspace grant once for both dialects", async () => {
    vi.mocked(hasGrantedWorkspaceAccess).mockResolvedValue(true);

    const access = await resolveProjectReaderAccess(
      COWORKER_AUTH,
      WORKSPACE_ID,
    );

    expect(hasGrantedWorkspaceAccess).toHaveBeenCalledOnce();
    expect(hasGrantedWorkspaceAccess).toHaveBeenCalledWith({
      vendorId: TEST_VENDOR_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(access.prismaWhere.taskWhere).toEqual({
      status: { not: TaskStatus.DRAFT },
      OR: [
        { visibility: TaskVisibility.PUBLIC },
        { visibility: TaskVisibility.PRIVATE, assigneeId: "coworker_123" },
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: { not: "coworker_123" },
          assignee: { vendorId: TEST_VENDOR_ID },
        },
      ],
    });
    expect(sqlValues(access.sqlWhere.task)).toEqual(
      sqlValues(
        buildCoworkerTaskAccessSql({
          coworkerId: "coworker_123",
          vendorId: TEST_VENDOR_ID,
          hasWorkspaceGrant: true,
        }),
      ),
    );
    expect(sqlValues(access.sqlWhere.job)).toEqual([
      "coworker_123",
      TEST_VENDOR_ID,
    ]);
  });

  it("uses the baseline coworker dialects without a bound context", async () => {
    const access = await resolveProjectReaderAccess(
      {
        actor: "coworker",
        coworkerId: "coworker_123",
        vendorId: TEST_VENDOR_ID,
      },
      WORKSPACE_ID,
    );

    expect(hasGrantedWorkspaceAccess).not.toHaveBeenCalled();
    expect(access.prismaWhere.taskWhere).toEqual({
      status: { not: TaskStatus.DRAFT },
      OR: [
        { assigneeId: "coworker_123" },
        {
          assigneeId: { not: "coworker_123" },
          assignee: { vendorId: TEST_VENDOR_ID },
        },
      ],
    });
    expect(sqlValues(access.sqlWhere.task)).toEqual(
      sqlValues(
        buildCoworkerTaskAccessSql({
          coworkerId: "coworker_123",
          vendorId: TEST_VENDOR_ID,
          hasWorkspaceGrant: false,
        }),
      ),
    );
  });

  it("keeps the Prisma-only wrapper on the same grant lookup", async () => {
    vi.mocked(hasGrantedWorkspaceAccess).mockResolvedValue(true);

    const visibility = await resolveProjectReaderVisibility(
      COWORKER_AUTH,
      WORKSPACE_ID,
    );

    expect(hasGrantedWorkspaceAccess).toHaveBeenCalledOnce();
    expect(visibility.taskWhere).toMatchObject({
      status: { not: TaskStatus.DRAFT },
    });
  });
});
