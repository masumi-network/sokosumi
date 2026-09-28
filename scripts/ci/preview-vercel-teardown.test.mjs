import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deleteVercelPreviews,
  listRefPreviews,
} from "./preview-vercel-teardown.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const REF = "feat/x";

describe("listRefPreviews", () => {
  it("pages with until and keeps only exact-ref non-production deployments", async () => {
    const pages = {
      first: {
        deployments: [
          { uid: "a", meta: { githubCommitRef: REF } },
          { uid: "prod", target: "production", meta: { githubCommitRef: REF } },
          { uid: "other", meta: { githubCommitRef: "feat/xy" } },
          { uid: "nometa" },
        ],
        pagination: { next: 111 },
      },
      111: {
        deployments: [{ uid: "b", meta: { githubCommitRef: REF } }],
        pagination: { next: null },
      },
    };
    const urls = [];
    const found = await listRefPreviews(
      {
        token: "t",
        teamId: "team",
        fetchImpl: async (url) => {
          urls.push(new URL(url));
          return json(pages[new URL(url).searchParams.get("until") ?? "first"]);
        },
      },
      { projectId: "prj", ref: REF },
    );
    assert.deepEqual(
      found.map((deployment) => deployment.uid),
      ["a", "b"],
    );
    assert.equal(urls[0].searchParams.get("branch"), REF);
    assert.equal(urls[0].searchParams.get("projectId"), "prj");
    assert.equal(urls[0].searchParams.get("teamId"), "team");
    assert.equal(urls[1].searchParams.get("until"), "111");
  });

  it("stops when the next cursor repeats", async () => {
    let calls = 0;
    await listRefPreviews(
      {
        token: "t",
        teamId: "team",
        fetchImpl: async () => {
          calls += 1;
          return json({ deployments: [], pagination: { next: 5 } });
        },
      },
      { projectId: "prj", ref: REF },
    );
    assert.equal(calls, 2);
  });
});

describe("deleteVercelPreviews", () => {
  const listBody = (uids) =>
    json({
      deployments: uids.map((uid) => ({ uid, meta: { githubCommitRef: REF } })),
      pagination: { next: null },
    });

  it("deletes by id with the team, and one failed delete skips no sibling", async () => {
    const deleteUrls = [];
    const fetchImpl = async (url, init = {}) => {
      if (init.method !== "DELETE") return listBody(["a", "b"]);
      deleteUrls.push(new URL(url));
      if (new URL(url).pathname.endsWith("/a")) throw new Error("timeout");
      return json({ state: "DELETED" });
    };
    const ok = await deleteVercelPreviews(
      { token: "t", teamId: "team", fetchImpl },
      { ref: REF, log: () => {} },
    );
    assert.equal(ok, false);
    assert.equal(deleteUrls.length, 8);
    assert.equal(deleteUrls[1].pathname, "/v13/deployments/b");
    assert.equal(deleteUrls[1].searchParams.get("teamId"), "team");
  });

  it("counts a 404 as deleted and any other error as a failure", async () => {
    const run = (deleteStatus) =>
      deleteVercelPreviews(
        {
          token: "t",
          teamId: "team",
          fetchImpl: async (url, init = {}) =>
            init.method === "DELETE" ? json({}, deleteStatus) : listBody(["a"]),
        },
        { ref: REF, log: () => {} },
      );
    assert.equal(await run(404), true);
    assert.equal(await run(403), false);
  });
});
