import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  task: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
}));
vi.mock("@/config/env", () => ({ getEnv: () => ({}) }));

import {
  folderTaskId,
  IMAGE_GENERATION_FOLDER_NAME,
  imageFileName,
  LEGACY_IMAGE_GENERATION_FOLDER_NAME,
} from "@/services/image-studio-files.service";

const input = {
  projectId: "p",
  workspaceId: "w",
  organizationId: null,
  userId: "u",
};

describe("folderTaskId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses and renames a folder still on the legacy name", async () => {
    tx.task.findFirst.mockResolvedValue({
      id: "t1",
      name: LEGACY_IMAGE_GENERATION_FOLDER_NAME,
    });
    expect(await folderTaskId(input)).toBe("t1");
    expect(tx.task.findFirst.mock.calls[0][0].where.name.in).toEqual([
      IMAGE_GENERATION_FOLDER_NAME,
      LEGACY_IMAGE_GENERATION_FOLDER_NAME,
    ]);
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { name: IMAGE_GENERATION_FOLDER_NAME },
    });
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it("reuses a current-name folder untouched", async () => {
    tx.task.findFirst.mockResolvedValue({
      id: "t2",
      name: IMAGE_GENERATION_FOLDER_NAME,
    });
    expect(await folderTaskId(input)).toBe("t2");
    expect(tx.task.update).not.toHaveBeenCalled();
  });

  it("creates the folder under the new name when none exists", async () => {
    tx.task.findFirst.mockResolvedValue(null);
    tx.task.create.mockResolvedValue({ id: "t3" });
    expect(await folderTaskId(input)).toBe("t3");
    const { data } = tx.task.create.mock.calls[0][0];
    expect(data.name).toBe(IMAGE_GENERATION_FOLDER_NAME);
    const [created, status] = data.events.create;
    expect(created).toMatchObject({
      status: TaskStatus.CREATED,
      userId: input.userId,
    });
    expect(status).toMatchObject({
      status: TaskStatus.COMPLETED,
      userId: input.userId,
    });
    expect(created.createdAt.getTime()).toBeLessThan(
      status.createdAt.getTime(),
    );
  });
});

describe("imageFileName", () => {
  it("slugs the prompt and keeps the job id so names never collide", () => {
    expect(
      imageFileName("A red fox, in the snow!", "3f2a9c1d-0000", "image/jpeg"),
    ).toBe("a-red-fox-in-the-snow-3f2a9c1d.jpg");
  });

  it("falls back to a plain name and png for an empty prompt or odd type", () => {
    expect(imageFileName("!!!", "abcdef12-0", "image/x-weird")).toBe(
      "image-abcdef12.png",
    );
  });
});
