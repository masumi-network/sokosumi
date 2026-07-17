import { describe, expect, it, vi } from "vitest";

import {
  extractNeonEndpointHost,
  planNeonPreviewBranchReset,
  previewNeonBranchName,
  resetNeonPreviewBranchFromParent,
} from "./neon-preview-branch-reset.js";

describe("previewNeonBranchName", () => {
  it("prefixes the git ref the way the Vercel Neon integration names branches", () => {
    expect(previewNeonBranchName("feat/my-change")).toBe(
      "preview/feat/my-change",
    );
  });
});

describe("extractNeonEndpointHost", () => {
  it("returns neon.tech hosts from connection strings", () => {
    expect(
      extractNeonEndpointHost(
        "postgresql://u:p@ep-cool-name-123.us-east-2.aws.neon.tech/neondb",
      ),
    ).toBe("ep-cool-name-123.us-east-2.aws.neon.tech");
  });

  it("ignores non-neon and invalid urls", () => {
    expect(extractNeonEndpointHost("postgresql://localhost:5432/core")).toBe(
      undefined,
    );
    expect(extractNeonEndpointHost("not-a-url")).toBe(undefined);
    expect(extractNeonEndpointHost(undefined)).toBe(undefined);
  });
});

describe("planNeonPreviewBranchReset", () => {
  it("skips outside Vercel Preview", () => {
    expect(planNeonPreviewBranchReset({})).toEqual({
      action: "skip",
      reason: "Neon branch reset runs only on Vercel Preview builds",
    });
    expect(
      planNeonPreviewBranchReset({
        VERCEL: "1",
        VERCEL_ENV: "production",
        NEON_API_KEY: "key",
        NEON_PROJECT_ID: "proj",
      }),
    ).toMatchObject({ action: "skip" });
  });

  it("fails closed on Preview without Neon credentials", () => {
    const result = planNeonPreviewBranchReset({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feat/x",
    });
    expect(result.action).toBe("error");
    if (result.action === "error") {
      expect(result.message).toMatch(/NEON_API_KEY and NEON_PROJECT_ID/);
    }
  });

  it("plans a reset with branch name from git ref", () => {
    expect(
      planNeonPreviewBranchReset({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feat/x",
        NEON_API_KEY: " key ",
        NEON_PROJECT_ID: " proj ",
      }),
    ).toEqual({
      action: "reset",
      apiKey: "key",
      projectId: "proj",
      branchId: undefined,
      branchName: "preview/feat/x",
      endpointHost: undefined,
    });
  });

  it("accepts NEON_BRANCH_ID override and endpoint host fallback", () => {
    expect(
      planNeonPreviewBranchReset({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        NEON_API_KEY: "key",
        NEON_PROJECT_ID: "proj",
        NEON_BRANCH_ID: "br-abc",
        DATABASE_URL_UNPOOLED:
          "postgresql://u:p@ep-host.us-east-2.aws.neon.tech/db",
      }),
    ).toMatchObject({
      action: "reset",
      branchId: "br-abc",
      endpointHost: "ep-host.us-east-2.aws.neon.tech",
    });
  });

  it("errors when Preview has creds but no branch locator", () => {
    const result = planNeonPreviewBranchReset({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      NEON_API_KEY: "key",
      NEON_PROJECT_ID: "proj",
    });
    expect(result.action).toBe("error");
  });
});

describe("resetNeonPreviewBranchFromParent", () => {
  it("returns null for skip plans", async () => {
    await expect(
      resetNeonPreviewBranchFromParent({
        action: "skip",
        reason: "nope",
      }),
    ).resolves.toBeNull();
  });

  it("throws for error plans", async () => {
    await expect(
      resetNeonPreviewBranchFromParent({
        action: "error",
        message: "missing creds",
      }),
    ).rejects.toThrow(/missing creds/);
  });

  it("resolves by name, restores from parent, and waits for operations", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/branches?search=")) {
        return new Response(
          JSON.stringify({
            branches: [
              {
                id: "br-child",
                name: "preview/feat/x",
                parent_id: "br-parent",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (
        url.endsWith("/branches/br-child/restore") &&
        init?.method === "POST"
      ) {
        expect(JSON.parse(String(init.body))).toEqual({
          source_branch_id: "br-parent",
        });
        return new Response(
          JSON.stringify({
            branch: {
              id: "br-child",
              name: "preview/feat/x",
              parent_id: "br-parent",
            },
            operations: [{ id: "op-1", status: "running" }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/operations/op-1")) {
        return new Response(
          JSON.stringify({ operation: { id: "op-1", status: "finished" } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await resetNeonPreviewBranchFromParent(
      {
        action: "reset",
        apiKey: "key",
        projectId: "proj",
        branchName: "preview/feat/x",
      },
      { fetch: fetchMock, sleep, pollIntervalMs: 1 },
    );

    expect(result).toEqual({
      branchId: "br-child",
      branchName: "preview/feat/x",
      parentBranchId: "br-parent",
      operationIds: ["op-1"],
    });
    expect(sleep).toHaveBeenCalled();
  });

  it("falls back to endpoint host when name lookup misses", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/branches?search=")) {
        return new Response(JSON.stringify({ branches: [] }), { status: 200 });
      }
      if (url.endsWith("/endpoints")) {
        return new Response(
          JSON.stringify({
            endpoints: [
              {
                id: "ep-1",
                host: "ep-host.us-east-2.aws.neon.tech",
                branch_id: "br-from-host",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/branches/br-from-host")) {
        return new Response(
          JSON.stringify({
            branch: {
              id: "br-from-host",
              name: "preview/other",
              parent_id: "br-parent",
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/restore")) {
        return new Response(
          JSON.stringify({
            branch: {
              id: "br-from-host",
              name: "preview/other",
              parent_id: "br-parent",
            },
            operations: [],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await resetNeonPreviewBranchFromParent(
      {
        action: "reset",
        apiKey: "key",
        projectId: "proj",
        branchName: "preview/feat/x",
        endpointHost: "ep-host.us-east-2.aws.neon.tech",
      },
      { fetch: fetchMock, sleep: async () => undefined },
    );

    expect(result?.branchId).toBe("br-from-host");
    expect(result?.parentBranchId).toBe("br-parent");
  });
});
