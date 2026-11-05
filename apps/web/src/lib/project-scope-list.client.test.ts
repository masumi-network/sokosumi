import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchScopeList } from "./project-scope-list.client";

function answer(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchScopeList", () => {
  const scope = { userId: "user-1", organizationId: "org-1" };

  it("hands back the rows read in the workspace asked about", async () => {
    answer({ scope, data: ["row"] });

    await expect(fetchScopeList("/api/project-scope", scope)).resolves.toEqual([
      "row",
    ]);
  });

  it.each([
    { userId: "user-1", organizationId: "org-2" },
    { userId: "user-2", organizationId: "org-1" },
    { userId: "user-1", organizationId: null },
  ])("refuses rows from another workspace: %j", async (readIn) => {
    answer({ scope: readIn, data: ["row"] });

    await expect(fetchScopeList("/api/project-scope", scope)).rejects.toThrow(
      "Project workspace changed",
    );
  });

  it("fails on an error status", async () => {
    answer({ error: "Projects unavailable" }, 503);

    await expect(fetchScopeList("/api/project-scope", scope)).rejects.toThrow(
      "503",
    );
  });
});
