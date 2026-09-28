import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountGet from "./get.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  adoptDriveStoreIfPendingMock,
  searchFilesMock,
  nudgeFileExtractionMock,
  resolveFileRequestContextMock,
} = vi.hoisted(() => ({
  adoptDriveStoreIfPendingMock: vi.fn(),
  searchFilesMock: vi.fn(),
  nudgeFileExtractionMock: vi.fn(),
  resolveFileRequestContextMock: vi.fn(),
}));

vi.mock("@/services/file-backfill.service", () => ({
  adoptDriveStoreIfPending: adoptDriveStoreIfPendingMock,
}));
vi.mock("@/services/file-search.service", () => ({
  searchFiles: searchFilesMock,
}));
vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileExtraction: nudgeFileExtractionMock,
}));
vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: resolveFileRequestContextMock,
}));

const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

/**
 * A search served from a catalog that is known to be missing files.
 *
 * Adoption gives pre-existing blobs a catalog identity, and the read path
 * contains its failures so that a Blob API outage cannot 500 a search
 * that works perfectly well from Postgres without it. That containment is
 * right and is not what these are about.
 *
 * What it did not do was say anything. The catch is only reachable when
 * `isDriveStoreBackfillPending` has already answered yes, so when it is
 * entered the catalog behind the results is *known* incomplete — and the
 * reader got a bare 200 and a short list, with the only record a
 * `console.warn` on a server they cannot read. "Some of your files are
 * not searchable yet" and "no results" are different sentences and only
 * one of them was true.
 *
 * Same policy as `rankingFallback` and the restart notice: a degradation
 * the code has computed reaches the caller, not only the log.
 */

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", AUTH);
    c.set("requestId", "req_123");
    await next();
  });
  mountGet(app);
  return app;
}

/** The shape `searchFiles` returns, with nothing interesting in it. */
function emptyResult() {
  return {
    items: [],
    search: {
      rankingMode: "deterministic" as const,
      rankingFallback: null,
      resultWindowLimit: 120,
      windowCount: 0,
      remainingWindowCount: 0,
      truncated: false,
      catalogIncomplete: false,
      hasMore: false,
      nextCursor: null,
      restarted: false,
      indexCoverage: { indexed: 0, processing: 0, filenameOnly: 0 },
    },
  };
}

async function search() {
  const response = await createApp().request("/?scope=me");
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  adoptDriveStoreIfPendingMock.mockReset().mockResolvedValue({ ran: false });
  searchFilesMock.mockReset().mockResolvedValue(emptyResult());
  nudgeFileExtractionMock.mockReset();
  resolveFileRequestContextMock.mockReset().mockResolvedValue({
    workspaceId: "ws_1",
    scope: "user",
    ownerId: "user_123",
    actor: { userId: "user_123", organizationId: null, kind: "interactive" },
  });
});

describe("a search served from an incomplete catalog", () => {
  it("still answers when adoption failed", async () => {
    // The containment, asserted first: this is what turns a 500 into a
    // working search, and nothing below is worth having without it.
    adoptDriveStoreIfPendingMock.mockResolvedValue({ ran: true, failed: true });

    const { status } = await search();

    expect(status).toBe(200);
  });

  it("says the catalog is incomplete when adoption failed", async () => {
    adoptDriveStoreIfPendingMock.mockResolvedValue({ ran: true, failed: true });

    const { body } = await search();

    expect(
      body.data.search.catalogIncomplete,
      "adoption is only attempted when the store is already pending, so a " +
        "failure here means files are missing from the catalog these " +
        "results came from — and the response said nothing about it",
    ).toBe(true);
  });

  it("does not claim a degradation when adoption succeeded", async () => {
    // The other direction. A flag that is always true says as little as
    // one that is never set.
    adoptDriveStoreIfPendingMock.mockResolvedValue({
      ran: true,
      outcome: { adopted: 0, complete: true },
    });

    const { body } = await search();

    expect(body.data.search.catalogIncomplete).toBe(false);
  });

  it("does not claim a degradation when there was nothing to adopt", async () => {
    const { body } = await search();

    expect(body.data.search.catalogIncomplete).toBe(false);
  });

  it("skips the indexing nudge on the degraded path", async () => {
    // Unchanged behaviour, pinned because it sits in the same branch as
    // the flag and a later edit could easily take it with it.
    adoptDriveStoreIfPendingMock.mockResolvedValue({ ran: true, failed: true });

    await search();

    expect(nudgeFileExtractionMock).not.toHaveBeenCalled();
  });
});
