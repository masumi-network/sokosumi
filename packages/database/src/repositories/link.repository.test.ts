import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { linkRepository } from "./link.repository.js";

describe("linkRepository.createLinks", () => {
  it("inserts every link in one call and skips stored duplicates", async () => {
    // Every call, not just the last: one statement for the whole batch is the
    // point of this repository, so a second one has to fail the test.
    const createManyCalls: unknown[] = [];
    // Prisma returns a lazy PrismaPromise: it sends no SQL until something
    // awaits it. The stub records on `then` for the same reason, so dropping
    // the `await` under test fails here instead of silently writing nothing.
    const tx = {
      link: {
        createMany: (args: unknown) => ({
          then: (resolve: (value: { count: number }) => void) => {
            createManyCalls.push(args);
            resolve({ count: 2 });
          },
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await linkRepository.createLinks(
      [
        { eventId: "event-1", url: "https://example.com/page" },
        { eventId: "event-1", url: "https://example.com/other" },
      ],
      tx,
    );

    assert.equal(createManyCalls.length, 1);
    assert.deepEqual(createManyCalls[0], {
      data: [
        { eventId: "event-1", url: "https://example.com/page" },
        { eventId: "event-1", url: "https://example.com/other" },
      ],
      skipDuplicates: true,
    });
  });
});
