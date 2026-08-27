import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { linkRepository } from "./link.repository.js";

describe("linkRepository.upsertLink", () => {
  it("returns the upserted link without loading the event relation", async () => {
    let upsertCall: unknown;
    const tx = {
      link: {
        upsert: async (args: unknown) => {
          upsertCall = args;
          return {
            id: "link-1",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            eventId: "event-1",
            url: "https://example.com/page",
            title: null,
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const link = await linkRepository.upsertLink(
      {
        eventId: "event-1",
        url: "https://example.com/page",
      },
      tx,
    );

    assert.equal(link.id, "link-1");
    assert.equal(link.eventId, "event-1");
    assert.equal((upsertCall as { include?: unknown }).include, undefined);
  });
});
