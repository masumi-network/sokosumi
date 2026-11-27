import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, lease, runJob } = vi.hoisted(() => ({
  db: {
    fileResource: { findUniqueOrThrow: vi.fn() },
    fileVersion: { findFirst: vi.fn() },
    fileChunk: { findMany: vi.fn() },
  },
  lease: vi.fn(),
  runJob: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/lib/files/index-jobs", () => ({ leaseNextFileIndexJob: lease }));
vi.mock("@/services/file-index.service", () => ({ runExtractionJob: runJob }));

import { untilReadable } from "./journey-world";

describe("a seeded file the bot must read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.fileResource.findUniqueOrThrow.mockResolvedValue({ contentRevision: 2 });
    lease.mockResolvedValue({ job: { id: "job" }, leaseOwner: "me" });
    db.fileChunk.findMany.mockResolvedValue([
      { text: "Result: 43% fewer no-shows in the first quarter." },
    ]);
  });

  it("is ready once its current version holds the expected text", async () => {
    db.fileVersion.findFirst.mockResolvedValue({ extractionState: "INDEXED" });
    await untilReadable("file", "story.pdf", "43% fewer no-shows");
    // Only its own extraction job, never the database-wide worker.
    expect(lease).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "file" }),
    );
    expect(db.fileVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { resourceId: "file", revision: 2 },
      }),
    );
  });

  it.each(["FAILED", "ENCRYPTED", "QUARANTINED", "UNSUPPORTED"])(
    "stops the setup when extraction ends %s",
    async (extractionState) => {
      db.fileVersion.findFirst.mockResolvedValue({ extractionState });
      await expect(
        untilReadable("file", "story.pdf", "43% fewer no-shows"),
      ).rejects.toThrow(/unreadable/);
    },
  );

  it("stops the setup when the extracted text lacks the fixture's facts", async () => {
    db.fileVersion.findFirst.mockResolvedValue({ extractionState: "INDEXED" });
    db.fileChunk.findMany.mockResolvedValue([{ text: "Something else." }]);
    await expect(
      untilReadable("file", "story.pdf", "43% fewer no-shows"),
    ).rejects.toThrow(/without its text/);
  });

  it("stops the setup when extraction never finishes", async () => {
    db.fileVersion.findFirst.mockResolvedValue({ extractionState: "PENDING" });
    await expect(
      untilReadable("file", "story.pdf", "43% fewer no-shows", 0),
    ).rejects.toThrow(/not extracted in time/);
  });
});
