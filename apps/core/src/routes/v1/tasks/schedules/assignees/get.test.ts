import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCoworkerUsableInWorkspaceWhere } from "@/helpers/access-control";
import { coworkerInclude } from "@/helpers/coworker";
import {
  COWORKER_AUTH,
  ORG_WORKSPACE_ID,
  OWNER_ID,
  SOKO_BOT_ID,
} from "@/test-fixtures/task-schedule";
import { createTaskScheduleTestApp } from "@/test-fixtures/task-schedule-app";

import mount from "./get";

const { coworkerFindMany, sokoBotFindFirst } = vi.hoisted(() => ({
  coworkerFindMany: vi.fn(),
  sokoBotFindFirst: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: { findMany: coworkerFindMany },
    sokoBot: { findFirst: sokoBotFindFirst },
  },
}));

describe("GET /tasks/schedules/assignees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coworkerFindMany.mockResolvedValue([]);
    sokoBotFindFirst.mockResolvedValue(null);
  });

  it("returns only task-capable coworkers and the owner's active Soko Bot", async () => {
    coworkerFindMany.mockResolvedValue([
      {
        id: "cow_123",
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
        updatedAt: new Date("2026-02-25T10:00:00.000Z"),
        archivedAt: null,
        isWhitelisted: true,
        priority: 10,
        capabilities: ["tasks"],
        slug: "ops-agent",
        name: "Ops Agent",
        baseURL: null,
        vendor: {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: new Date("2026-02-25T10:00:00.000Z"),
          updatedAt: new Date("2026-02-25T10:00:00.000Z"),
          name: "Vendor",
          slug: "vendor",
          logoLight: null,
          logoDark: null,
        },
      },
    ]);
    sokoBotFindFirst.mockResolvedValue({
      id: SOKO_BOT_ID,
      name: "Atlas",
      avatarSeed: null,
      avatarImageUrl: null,
    });

    const response = await createTaskScheduleTestApp(mount).request(
      "http://localhost/schedules/assignees",
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      coworkers: [{ id: "cow_123", name: "Ops Agent" }],
      sokoBot: { id: SOKO_BOT_ID, name: "Atlas" },
    });
    expect(coworkerFindMany).toHaveBeenCalledWith({
      where: {
        ...buildCoworkerUsableInWorkspaceWhere(ORG_WORKSPACE_ID),
        capabilities: { has: "tasks" },
      },
      orderBy: [{ priority: "desc" }, { slug: "asc" }],
      include: coworkerInclude,
    });
    expect(sokoBotFindFirst).toHaveBeenCalledWith({
      where: {
        userId: OWNER_ID,
        workspaceId: ORG_WORKSPACE_ID,
        archivedAt: null,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        avatarSeed: true,
        avatarImageUrl: true,
      },
    });
  });

  it("rejects coworker actors", async () => {
    const response = await createTaskScheduleTestApp(
      mount,
      COWORKER_AUTH,
    ).request("http://localhost/schedules/assignees");

    expect(response.status).toBe(403);
    expect(coworkerFindMany).not.toHaveBeenCalled();
  });
});
