import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: { findMany: vi.fn() },
  coworker: { findMany: vi.fn() },
  agent: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
  job: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import {
  buildSokoBotScopeJobWhere,
  buildSokoBotScopeTaskWhere,
  sokoBotTurnReader,
} from "@/helpers/task-visibility";
import { loadClassificationContext } from "./classification-context";

const scope = { sokoBotId: "bot-1", workspaceId: "ws-1", projectId: "p-1" };

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(db)) model.findMany.mockResolvedValue([]);
});

describe("loadClassificationContext for a shared bot", () => {
  it("reads only the bot's scope, never the member's private view", async () => {
    await loadClassificationContext(
      sokoBotTurnReader("member", "OWNER", scope),
      "ws-1",
      'What about "Apollo launch" task-0123456789abcdef?',
    );
    expect(db.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws-1", id: "p-1" } }),
    );
    expect(db.coworker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          OR: [
            { isWhitelisted: true },
            {
              workspaceAccess: {
                some: { workspaceId: "ws-1", status: "GRANTED" },
              },
            },
          ],
        },
      }),
    );
    for (const [call] of db.task.findMany.mock.calls) {
      expect(call.where).toMatchObject(buildSokoBotScopeTaskWhere(scope));
      expect(call.where).not.toHaveProperty("OR");
    }
    // A shared reader is never OWNER, so no owner-only name search runs.
    expect(db.task.findMany).toHaveBeenCalledTimes(2);
    expect(db.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...buildSokoBotScopeJobWhere(scope), workspaceId: "ws-1" },
      }),
    );
  });
});
