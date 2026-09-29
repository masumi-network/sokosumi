import { describe, expect, it, vi } from "vitest";

import { COWORKER_AUTH } from "@/test-fixtures/task-schedule";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";

import mount from "./moved-schedule-routes";

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const TASK_ID = "01960001-0001-7001-8001-0000000000f1";

describe("removed per-Task schedule routes", () => {
  it.each([
    ["POST", "/scheduled", "POST /v1/tasks/schedules"],
    ["PUT", `/${TASK_ID}/schedule`, "POST /v1/tasks/schedules"],
    ["DELETE", `/${TASK_ID}/schedule`, "DELETE /v1/tasks/schedules/{id}"],
    ["PUT", `/${TASK_ID}/calendar-schedule`, "PATCH /v1/tasks/schedules/{id}"],
    ["PUT", `/${TASK_ID}/calendar-source`, "PATCH /v1/tasks/schedules/{id}"],
    [
      "GET",
      `/${TASK_ID}/schedule/occurrences`,
      "GET /v1/tasks/schedules/{id}/runs",
    ],
    [
      "PATCH",
      `/${TASK_ID}/schedule/occurrences/occ_1`,
      "PATCH /v1/tasks/schedules/{id}/runs/{runId}",
    ],
  ])(
    "%s %s answers 410 task_schedule_moved pointing to %s",
    async (method, path, replacement) => {
      const app = createTaskScheduleTestApp(mount);

      const response = await app.request(
        `http://localhost${path}`,
        jsonRequest(method, method === "GET" ? undefined : {}),
      );

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        error: "Gone",
        kind: "task_schedule_moved",
        replacement,
      });
    },
  );

  it("answers a Coworker vendor the same way", async () => {
    const app = createTaskScheduleTestApp(mount, COWORKER_AUTH);

    const response = await app.request(
      "http://localhost/scheduled",
      jsonRequest("POST", { name: "Weekly report" }),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      kind: "task_schedule_moved",
      replacement: "POST /v1/tasks/schedules",
    });
  });
});
