import type { TaskSchedule } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountDelete from "@/routes/v1/tasks/schedules/[id]/delete";
import mountEnd from "@/routes/v1/tasks/schedules/[id]/end/post";
import mountGet from "@/routes/v1/tasks/schedules/[id]/get";
import mountPatch from "@/routes/v1/tasks/schedules/[id]/patch";
import mountPause from "@/routes/v1/tasks/schedules/[id]/pause/post";
import mountResume from "@/routes/v1/tasks/schedules/[id]/resume/post";
import mountRunPatch from "@/routes/v1/tasks/schedules/[id]/runs/[runId]/patch";
import mountRunNow from "@/routes/v1/tasks/schedules/[id]/runs/post";
import mountList from "@/routes/v1/tasks/schedules/get";
import {
  COWORKER_AUTH,
  COWORKER_ID,
  MEMBER_ID,
  ORG_WORKSPACE,
  OWNER_ID,
  PERSONAL_WORKSPACE,
  PERSONAL_WORKSPACE_ID,
  resetTaskScheduleTestDb,
  SOKO_BOT_AUTH,
  seedRun,
  seedTaskSchedule,
  taskScheduleTestDb,
  userAuth,
} from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/lib/db/prisma", async () => ({
  default: (await import("@/test-fixtures/task-schedule"))
    .taskScheduleTestPrisma,
}));
vi.mock("@sokosumi/database/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/helpers")>()),
  hasAssignedOrganizationSeat: async () =>
    (await import("@/test-fixtures/task-schedule")).taskScheduleTestDb
      .seatAssigned,
}));
vi.mock("@/lib/ably/publish", () => ({ publishTaskEventData: vi.fn() }));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskHumanAssignee: vi.fn(),
}));

function mountAll(app: OpenAPIHonoWithAuth) {
  for (const mount of [
    mountList,
    mountGet,
    mountPatch,
    mountPause,
    mountResume,
    mountEnd,
    mountDelete,
    mountRunNow,
    mountRunPatch,
  ]) {
    mount(app);
  }
}

interface ReaderCase {
  name: string;
  auth: AuthenticationContext;
  schedule?: Partial<TaskSchedule>;
  canWrite: boolean;
  readStatus?: number;
}

const READERS: ReaderCase[] = [
  { name: "PUBLIC owner", auth: userAuth(), canWrite: true },
  {
    name: "PUBLIC teammate / user API key",
    auth: userAuth(MEMBER_ID),
    canWrite: true,
  },
  {
    name: "PRIVATE owner",
    auth: userAuth(),
    schedule: { visibility: "PRIVATE" },
    canWrite: true,
  },
  {
    name: "PRIVATE teammate",
    auth: userAuth(MEMBER_ID),
    schedule: { visibility: "PRIVATE" },
    canWrite: false,
    readStatus: 404,
  },
  {
    name: "PUBLIC coworker assigned family",
    auth: COWORKER_AUTH,
    schedule: { ownerId: MEMBER_ID, assigneeId: COWORKER_ID },
    canWrite: true,
  },
  {
    name: "PUBLIC coworker creator outside family",
    auth: COWORKER_AUTH,
    schedule: { ownerId: MEMBER_ID, creatorCoworkerId: COWORKER_ID },
    canWrite: true,
  },
  {
    name: "PUBLIC coworker outside family",
    auth: COWORKER_AUTH,
    canWrite: false,
  },
  {
    name: "PRIVATE coworker owner family",
    auth: COWORKER_AUTH,
    schedule: { visibility: "PRIVATE", assigneeId: COWORKER_ID },
    canWrite: true,
  },
  {
    name: "PRIVATE coworker other owner family",
    auth: COWORKER_AUTH,
    schedule: {
      visibility: "PRIVATE",
      ownerId: MEMBER_ID,
      assigneeId: COWORKER_ID,
    },
    canWrite: false,
    readStatus: 404,
  },
  {
    name: "PRIVATE coworker creator outside family",
    auth: COWORKER_AUTH,
    schedule: { visibility: "PRIVATE", creatorCoworkerId: COWORKER_ID },
    canWrite: false,
    readStatus: 404,
  },
];

const ACTIONS = [
  "edit",
  "pause",
  "resume",
  "end",
  "delete",
  "run",
  "skip",
  "move",
  "restore",
] as const;
type Action = (typeof ACTIONS)[number];
const FUTURE = new Date("2030-01-07T09:00:00.000Z");

function prepareAction(action: Action, overrides: Partial<TaskSchedule> = {}) {
  const schedule = seedTaskSchedule({
    ...overrides,
    state: action === "resume" ? "PAUSED" : "ACTIVE",
  });
  const run = seedRun(schedule, FUTURE, {
    state: action === "restore" ? "SKIPPED" : "PLANNED",
  });
  const path = `/schedules/${schedule.id}`;
  switch (action) {
    case "edit":
      return {
        path,
        method: "PATCH",
        body: {
          expectedRevision: 0,
          name: "Shared edit",
          visibility: "PRIVATE",
          ownerId: MEMBER_ID,
        },
      };
    case "delete":
      return { path, method: "DELETE" };
    case "run":
      return {
        path: `${path}/runs`,
        method: "POST",
        body: { expectedRevision: 0 },
      };
    case "skip":
    case "move":
    case "restore":
      return {
        path: `${path}/runs/${run.id}`,
        method: "PATCH",
        body: {
          expectedRevision: 0,
          action,
          ...(action === "move"
            ? { scheduledAt: "2030-01-08T09:00:00.000Z" }
            : {}),
        },
      };
    default:
      return { path: `${path}/${action}`, method: "POST" };
  }
}

describe("Task Schedule shared authorization contract", () => {
  beforeEach(() => {
    resetTaskScheduleTestDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  describe.each(READERS)("$name", (reader) => {
    it("returns capabilities consistent with visibility in list and detail", async () => {
      const schedule = seedTaskSchedule(reader.schedule);
      const app = createTaskScheduleTestApp(mountAll, reader.auth);
      const detail = await app.request(
        `http://localhost/schedules/${schedule.id}`,
      );
      expect(detail.status).toBe(reader.readStatus ?? 200);
      const list = await app.request("http://localhost/schedules");
      expect(list.status).toBe(200);
      if (reader.readStatus === 404) {
        expect(await list.json()).toMatchObject({ data: [] });
      } else {
        expect(await detail.json()).toMatchObject({
          data: { ownerId: schedule.ownerId, canWrite: reader.canWrite },
        });
        expect(await list.json()).toMatchObject({
          data: [{ id: schedule.id, canWrite: reader.canWrite }],
        });
      }
    });

    it.each(ACTIONS)(
      "%s follows the returned write capability",
      async (action) => {
        const request = prepareAction(action, reader.schedule);
        const before = structuredClone({
          schedules: taskScheduleTestDb.schedules,
          runs: taskScheduleTestDb.runs,
        });
        const app = createTaskScheduleTestApp(mountAll, reader.auth);
        const response = await app.request(
          `http://localhost${request.path}`,
          jsonRequest(request.method, request.body),
        );
        const expected =
          reader.readStatus ??
          (reader.canWrite
            ? action === "delete"
              ? 204
              : action === "run"
                ? 201
                : 200
            : 403);
        expect(response.status).toBe(expected);
        if (!reader.canWrite) {
          expect(taskScheduleTestDb.schedules).toEqual(before.schedules);
          expect(taskScheduleTestDb.runs).toEqual(before.runs);
        } else if (["edit", "pause", "resume", "end"].includes(action)) {
          expect(await response.json()).toMatchObject({
            data: {
              ownerId: reader.schedule?.ownerId ?? OWNER_ID,
              canWrite: true,
              visibility: reader.schedule?.visibility ?? "PUBLIC",
            },
          });
        } else if (["run", "skip", "move", "restore"].includes(action)) {
          expect(await response.json()).toMatchObject({
            data: {
              run: {
                actorUserId:
                  reader.auth.actor === "user" ? reader.auth.userId : null,
                actorCoworkerId:
                  reader.auth.actor === "coworker" ? COWORKER_ID : null,
              },
            },
          });
          if (action === "run") {
            expect(taskScheduleTestDb.tasks[0]).toMatchObject({
              ownerId: reader.schedule?.ownerId ?? OWNER_ID,
              visibility: reader.schedule?.visibility ?? "PUBLIC",
            });
          }
        }
      },
    );
  });

  it.each(ACTIONS)(
    "refuses %s after the member's Seat is removed",
    async (action) => {
      const request = prepareAction(action);
      taskScheduleTestDb.seatAssigned = false;
      const app = createTaskScheduleTestApp(mountAll, userAuth(MEMBER_ID));
      const response = await app.request(
        `http://localhost${request.path}`,
        jsonRequest(request.method, request.body),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        kind: "organization_seat_required",
      });
    },
  );

  it.each(ACTIONS)(
    "refuses %s after the coworker grant is revoked",
    async (action) => {
      const request = prepareAction(action, {
        ownerId: MEMBER_ID,
        assigneeId: COWORKER_ID,
      });
      taskScheduleTestDb.vendorGrantStatus = "REVOKED";
      const app = createTaskScheduleTestApp(mountAll, COWORKER_AUTH);
      const response = await app.request(
        `http://localhost${request.path}`,
        jsonRequest(request.method, request.body),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ kind: "grant_revoked" });
    },
  );

  it.each(ACTIONS)(
    "does not let Soko Bot manage schedules through %s",
    async (action) => {
      const request = prepareAction(action);
      const app = createTaskScheduleTestApp(mountAll, SOKO_BOT_AUTH);
      const response = await app.request(
        `http://localhost${request.path}`,
        jsonRequest(request.method, request.body),
      );
      expect(response.status).toBe(403);
    },
  );

  it.each(ACTIONS)(
    "keeps %s scoped to the current workspace",
    async (action) => {
      const request = prepareAction(action, {
        workspaceId: PERSONAL_WORKSPACE_ID,
        organizationId: null,
      });
      const app = createTaskScheduleTestApp(
        mountAll,
        userAuth(MEMBER_ID),
        ORG_WORKSPACE,
      );
      const response = await app.request(
        `http://localhost${request.path}`,
        jsonRequest(request.method, request.body),
      );
      expect(response.status).toBe(404);
    },
  );

  it("keeps the personal workspace owner's schedule writable", async () => {
    const schedule = seedTaskSchedule({
      workspaceId: PERSONAL_WORKSPACE_ID,
      organizationId: null,
    });
    const app = createTaskScheduleTestApp(
      mountAll,
      { actor: "user", userId: OWNER_ID, organizationId: null, role: "user" },
      PERSONAL_WORKSPACE,
    );
    const response = await app.request(
      `http://localhost/schedules/${schedule.id}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { ownerId: OWNER_ID, canWrite: true },
    });
  });
});
