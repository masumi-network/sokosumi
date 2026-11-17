import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { coreEvlogMiddleware } from "@/lib/evlog";
import { causeMessage, expectCoreLog } from "@/test/core-log";

vi.mock("@/lib/ably/publish", () => ({
  publishCalendarAccessRevoked: vi.fn(),
  publishCalendarInvalidationToUsers: vi.fn(),
}));
vi.mock("@/helpers/notification-email-dispatch", () => ({
  cancelNotificationEmails: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      create: async () => ({ id: "project-1", workspaceId: "workspace-1" }),
    },
    calendarInvalidationOutbox: { findMany: async () => [] },
    $executeRaw: async () => {
      throw new Error("connection reset");
    },
  },
}));

import { createProject } from "./projects.service";

describe("createProject", () => {
  it("records a failed Calendar prune on the creating request's event", async () => {
    const errors = expectCoreLog(
      "error",
      "Could not delete old published Calendar invalidations",
    );
    const app = new Hono();
    app.use(coreEvlogMiddleware());
    app.post("/projects", async (c) =>
      c.json(await createProject("workspace-1", { name: "Launch" })),
    );

    const response = await app.request("http://localhost/projects", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(errors[0]).toMatchObject({ why: "The database delete failed" });
    expect(causeMessage(errors[0]?.cause)).toBe("connection reset");
    expect(errors[0]?.event).toMatchObject({
      method: "POST",
      path: "/projects",
    });
    expect(errors[0]?.event.operation).toBeUndefined();
  });
});
