import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: { $queryRaw: vi.fn() } }));

import { rankContacts } from "@/services/contact-search.service";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";

/** An error whose every property read throws, as a hostile proxy might. */
function errorWithThrowingGetters(): Error {
  const error = new Error("embedding failed");
  for (const key of ["name", "code", "status", "statusCode", "details"])
    Object.defineProperty(error, key, {
      get() {
        throw new Error("getter exploded");
      },
    });
  return error;
}

describe("rankContacts when the query cannot be embedded", () => {
  it("still answers without meaning matches when reading the error throws", async () => {
    const errors = expectCoreLog(
      "error",
      "Could not embed a contact search query",
    );
    const embed = vi.fn().mockRejectedValue(errorWithThrowingGetters());

    await expect(
      rankContacts("workspace-1", "jane", { mode: "meaning", embed }),
    ).resolves.toEqual([]);

    expect(errors[0]?.event).toMatchObject({
      failure: { errorName: "Error" },
    });
  });

  it("keeps content in the error's name and code out of the drain", async () => {
    const errors = expectCoreLog(
      "error",
      "Could not embed a contact search query",
    );
    const embed = vi.fn().mockRejectedValue(
      Object.assign(new Error("embedding failed for SECRET-QUERY"), {
        name: "SECRET-QUERY jane.doe@example.com",
        code: "SECRET_QUERY_CODE",
      }),
    );

    await expect(
      rankContacts("workspace-1", "jane", { mode: "meaning", embed }),
    ).resolves.toEqual([]);

    expect(errors[0]?.event.failure).toEqual({ errorName: "Error" });
    expect(JSON.stringify(coreLogEvents())).not.toMatch(/SECRET[-_]QUERY/);
  });
});
