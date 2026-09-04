import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { BlobStatus } from "../generated/prisma/client.js";
import { blobRepository } from "./blob.repository.js";

describe("blobRepository.createOutputBlobs", () => {
  it("inserts every blob as PENDING in one call and skips stored duplicates", async () => {
    // Every call, not just the last: one statement for the whole batch is the
    // point of this repository, so a second one has to fail the test.
    const createManyCalls: unknown[] = [];
    // Prisma returns a lazy PrismaPromise: it sends no SQL until something
    // awaits it. The stub records on `then` for the same reason, so dropping
    // the `await` under test fails here instead of silently writing nothing.
    const tx = {
      blob: {
        createMany: (args: unknown) => ({
          then: (resolve: (value: { count: number }) => void) => {
            createManyCalls.push(args);
            resolve({ count: 2 });
          },
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await blobRepository.createOutputBlobs(
      [
        {
          eventId: "event-1",
          sourceUrl: "https://example.com/result.pdf",
          name: "result.pdf",
        },
        {
          eventId: "event-1",
          sourceUrl: "https://example.com/notes.pdf",
          name: "notes.pdf",
        },
      ],
      tx,
    );

    assert.equal(createManyCalls.length, 1);
    assert.deepEqual(createManyCalls[0], {
      data: [
        {
          eventId: "event-1",
          sourceUrl: "https://example.com/result.pdf",
          name: "result.pdf",
          status: BlobStatus.PENDING,
        },
        {
          eventId: "event-1",
          sourceUrl: "https://example.com/notes.pdf",
          name: "notes.pdf",
          status: BlobStatus.PENDING,
        },
      ],
      skipDuplicates: true,
    });
  });
});
