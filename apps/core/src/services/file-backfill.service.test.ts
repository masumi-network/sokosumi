import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ BLOB_READ_WRITE_TOKEN: "blob-token" }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { fileEvidenceScope: { findUnique: findUniqueMock } },
}));
vi.mock("@/lib/drive-blob", () => ({ driveList: vi.fn() }));
vi.mock("@/lib/files/evidence-scope", () => ({
  ensureEvidenceScope: vi.fn(),
}));
vi.mock("@/services/file-catalog.service", () => ({
  adoptDriveUploadResource: vi.fn(),
}));

import { adoptDriveStoreIfPending } from "@/services/file-backfill.service";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

const FILENAME = "users/u-1/Q3-layoffs-confidential.pdf";
const SECRET = "sk_live_abc123";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adoptDriveStoreIfPending", () => {
  it("logs a failed adoption without the file names or secrets its error quotes", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Could not adopt the Drive store; the search served the catalog",
      ["Listing or recording the Drive store failed"],
    );
    // A Blob or database error can quote the pathname it was working on.
    findUniqueMock.mockRejectedValue(
      Object.assign(
        new Error(`Blob list failed for ${FILENAME} with token ${SECRET}`),
        { name: "PrismaClientUnknownRequestError" },
      ),
    );

    await expect(
      adoptDriveStoreIfPending({
        workspaceId: "workspace-1",
        scope: "user",
        ownerId: "u-1",
      }),
    ).resolves.toEqual({ ran: true, failed: true });

    expect(warnings[0]?.cause).toBeUndefined();
    expect(warnings[0]?.event).toMatchObject({
      operation: "files_drive_store_adoption",
      driveStore: { scope: "user" },
      failure: { errorName: "PrismaClientUnknownRequestError" },
    });
    const drained = JSON.stringify(coreLogEvents());
    expect(drained).not.toContain("Q3-layoffs-confidential");
    expect(drained).not.toContain("sk_live");
  });
});
