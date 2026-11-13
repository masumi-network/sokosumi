import { beforeEach, describe, expect, it, vi } from "vitest";

const createEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/prisma", () => ({
  default: { adEvent: { create: createEvent } },
}));

import { recordStudioAdEvent } from "./image-studio-events.service";

describe("recordStudioAdEvent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("appends the preference signal and its actor", async () => {
    await recordStudioAdEvent({
      workspaceId: "workspace-1",
      assetId: "asset-1",
      userId: "user-1",
      type: "downloaded",
      meta: { format: "png" },
    });
    expect(createEvent).toHaveBeenCalledExactlyOnceWith({
      data: {
        workspaceId: "workspace-1",
        assetId: "asset-1",
        userId: "user-1",
        type: "downloaded",
        meta: { format: "png" },
      },
    });
  });

  it("never fails the user's action when the event store is unavailable", async () => {
    createEvent.mockRejectedValue(new Error("database unavailable"));
    await expect(
      recordStudioAdEvent({
        workspaceId: "workspace-1",
        assetId: "asset-1",
        type: "refined",
      }),
    ).resolves.toBeUndefined();
  });
});
