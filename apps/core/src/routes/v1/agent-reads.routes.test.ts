// Before `@/middleware/auth` loads `@sokosumi/utils`: zod 4 gives a schema
// `.openapi` only if `@hono/zod-openapi` loaded before the schema was built.
import "@hono/zod-openapi";

import { describe, expect, it, vi } from "vitest";

import { coreV1 } from "@/lib/sokosumi-mcp/dispatch";
import {
  type AuthenticationContext,
  preAuthenticatedRequests,
} from "@/middleware/auth";

/**
 * SOKD-378: agents (user API keys, and MCP tokens, which call `/v1` as an
 * OAuth user) read ads, image-studio, social and calendar data. Every write
 * on those routes stays with a person at the keyboard (ADR 0077).
 */

// Past the guard, a handler reaches the database: every query fails, so a
// 500 (not a 403) shows the guard let the caller in.
// No `oauthResource`: Better Auth's startup seed skips a missing table.
vi.mock("@/lib/db/prisma", () => {
  const fail = () => Promise.reject(new Error("database reached"));
  const model = new Proxy({}, { get: () => fail });
  const client: object = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "$transaction"
          ? (run: unknown) =>
              typeof run === "function" ? run(client) : Promise.all([])
          : key === "then" || key === "oauthResource"
            ? undefined
            : model,
    },
  );
  return { default: client };
});

vi.mock("@sokosumi/database/repositories", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  workspaceRepository: {
    resolveWorkspaceForContext: async () => ({
      id: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
    }),
  },
}));

// A write under `/projects/{id}` first checks the Project is not CMO's.
vi.mock("@/services/cmo-cuso.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireNotCmoProject: async () => undefined,
}));

const USER_ID = "user_agent";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";

const user = (
  authenticationMethod: "api_key" | "oauth",
): AuthenticationContext => ({
  actor: "user",
  userId: USER_ID,
  organizationId: null,
  role: "user",
  authenticationMethod,
});
const CALLERS = [
  ["a user API key", user("api_key")],
  ["an MCP token", user("oauth")],
] as const;

const P = `/projects/${ID}`;
const CALENDAR = new URLSearchParams({
  from: "2026-11-01T00:00:00.000Z",
  to: "2026-12-01T00:00:00.000Z",
  types: "tasks,social,newsletter,contacts,marketing,sokoBot",
});

/** The reads this ticket opens, as `/v1` requests. */
const OPENED_READS = [
  "/image-studio/catalog",
  "/image-studio/state",
  "/image-studio/recent-projects",
  `${P}/ads/accounts`,
  `${P}/ads/accounts/${ID}/campaigns`,
  `${P}/ads/accounts/${ID}/campaigns/123`,
  `${P}/ads/accounts/${ID}/targeting/locations?q=Berlin`,
  `${P}/ads/accounts/${ID}/targeting/languages`,
  `${P}/ads/market`,
  `${P}/image-studio`,
  `${P}/image-studio/batches/${ID}/assets`,
  `${P}/image-studio/batches/${ID}/compare`,
  `${P}/image-studio/model-scoreboard`,
  `${P}/image-studio/brand-kit`,
  `${P}/image-studio/brand-kit/website-copy`,
  `${P}/image-studio/website-draft`,
  `${P}/image-studio/products`,
  `${P}/image-studio/talking-videos`,
  `${P}/image-studio/assets/${ID}/content`,
  `${P}/social-connections`,
  `${P}/social-connections/${ID}/subscription`,
  `${P}/social-connections/${ID}/tiktok-creator`,
  `${P}/social-connections/${ID}/suggested-times?timezone=UTC`,
  `${P}/social-connections/statistics`,
  `${P}/social-connections/statistics/export?format=csv`,
  `${P}/social-posts`,
  `${P}/social-posts/${ID}`,
  `${P}/social-posts/statistics`,
  `${P}/social-queue-slots`,
  `${P}/calendar?${CALENDAR}`,
  `/workspaces/calendar?${CALENDAR}`,
  "/workspaces/calendar/sources?includeSocialPosts=true",
  "/workspaces/social-posts",
  `/workspaces/${WORKSPACE_ID}/social-connections/statistics`,
  `/workspaces/${WORKSPACE_ID}/social-connections/statistics/export?format=csv`,
];

/**
 * Reads that stay with a person: they buy DataForSEO data on a cache miss, or
 * copy a private studio asset to a permanent public URL.
 */
const HUMAN_ONLY_READS = [
  `${P}/ads/market/keywords`,
  `${P}/ads/market/ads`,
  `${P}/image-studio/assets/${ID}/social-media`,
];

/**
 * Writes on the same routes, each with a body that passes validation, so the
 * answer is the guard's: they all still need a browser session.
 */
const SCRIPT = "Twenty characters or more, spoken aloud.";
const KEY = "idempotency-key-1";
const CAMPAIGN = { name: "Spring", dailyBudget: 10 };
function logoUpload(): FormData {
  const form = new FormData();
  form.append("file", new Blob(["png"], { type: "image/png" }), "logo.png");
  return form;
}
const HUMAN_ONLY_WRITES: readonly [
  method: string,
  path: string,
  body?: object,
][] = [
  [
    "POST",
    `${P}/ads/accounts`,
    { adConnectionId: ID, externalAccountIds: ["1"] },
  ],
  ["DELETE", `${P}/ads/accounts/${ID}`],
  ["POST", `${P}/ads/connections/initiate`, { provider: "google_ads" }],
  ["POST", `${P}/ads/connections/finalize`, { connectionId: "ca_1" }],
  ["DELETE", `${P}/ads/connections/${ID}`],
  ["POST", `${P}/ads/accounts/${ID}/campaigns`, CAMPAIGN],
  [
    "PUT",
    `${P}/ads/accounts/${ID}/campaigns/123`,
    {
      ...CAMPAIGN,
      google: {
        type: "SEARCH",
        startDate: "2030-10-01",
        locationIds: ["2276"],
        languageIds: ["1001"],
        finalUrl: "https://example.com/spring",
        keywords: [{ text: "running shoes", matchType: "BROAD" }],
        headlines: ["One", "Two", "Three"],
        descriptions: ["First description", "Second description"],
      },
    },
  ],
  ["PATCH", `${P}/ads/accounts/${ID}/campaigns/123`, { status: "PAUSED" }],
  [
    "PUT",
    `${P}/ads/market`,
    { keywords: ["lamp"], countryCode: "DE", languageCode: "de" },
  ],
  [
    "PUT",
    `${P}/image-studio/batches/${ID}/compare`,
    { assetId: ID, otherAssetId: WORKSPACE_ID, outcome: "A" },
  ],
  [
    "PUT",
    `${P}/image-studio/brand-kit`,
    {
      copy: { summary: "Lamps", tone: "Calm", audience: [], approvedLines: [] },
      version: null,
    },
  ],
  ["POST", `${P}/image-studio/website-draft`, {}],
  ["PUT", `${P}/image-studio/brand-kit/look`, { look: null, lookRevision: 0 }],
  ["POST", `${P}/image-studio/brand-kit/logo`, logoUpload()],
  ["POST", `${P}/image-studio/brand-kit/logo/website`, {}],
  ["POST", `${P}/image-studio/jobs`, { prompt: "A lamp", idempotencyKey: KEY }],
  ["PUT", `${P}/image-studio/products`, { products: [], revision: 0 }],
  ["POST", `${P}/image-studio/products/import`, { url: "https://example.com" }],
  [
    "POST",
    `${P}/image-studio/products/photo`,
    { name: "Lamp", imageUrl: "https://example.com/lamp.png" },
  ],
  [
    "POST",
    `${P}/image-studio/video-jobs`,
    { prompt: "A lamp", idempotencyKey: KEY },
  ],
  [
    "POST",
    `${P}/image-studio/talking-video-jobs`,
    {
      script: SCRIPT,
      presenter: { kind: "stock", id: "p1" },
      idempotencyKey: KEY,
    },
  ],
  [
    "POST",
    `${P}/image-studio/short-video-jobs`,
    { format: "voiceover", script: SCRIPT, idempotencyKey: KEY },
  ],
  ["POST", `${P}/image-studio/talking-video-scripts`, {}],
  ["POST", `${P}/image-studio/jobs/${ID}/cancel`, {}],
  [
    "POST",
    `${P}/image-studio/assets/${ID}/events`,
    { type: "viewed_lightbox" },
  ],
  ["PUT", `${P}/image-studio/assets/${ID}/feedback`, { thumb: 1 }],
  ["POST", `${P}/image-studio/assets/${ID}/hide`, {}],
  ["PUT", `${P}/image-studio/assets/${ID}/headline`, { text: "Hello" }],
  ["POST", `${P}/image-studio/assets/${ID}/caption`, {}],
  [
    "POST",
    `${P}/social-connections/initiate`,
    { action: "connect", provider: "linkedin" },
  ],
  ["POST", `${P}/social-connections/finalize`, { connectionId: "ca_1" }],
  ["DELETE", `${P}/social-connections/${ID}`],
  ["POST", `${P}/social-connections/${ID}/statistics/refresh`, {}],
  ["POST", `${P}/social-posts`, { text: "Hello" }],
  ["PATCH", `${P}/social-posts/${ID}`, { revision: 1 }],
  ["POST", `${P}/social-posts/${ID}/publish`, { revision: 1 }],
  [
    "POST",
    `${P}/social-posts/${ID}/schedule`,
    { revision: 1, scheduledAt: "2030-01-01T00:00:00.000Z" },
  ],
  ["POST", `${P}/social-posts/${ID}/queue`, { revision: 1 }],
  ["POST", `${P}/social-posts/${ID}/approve`, { revision: 1 }],
  ["POST", `${P}/social-posts/${ID}/reject`, { revision: 1 }],
  ["POST", `${P}/social-posts/${ID}/cancel`, { revision: 1 }],
  ["POST", `${P}/social-posts/${ID}/duplicate`, {}],
  [
    "POST",
    `${P}/social-posts/${ID}/thread/resume`,
    { revision: 1, confirmedNotPosted: true },
  ],
  ["POST", `${P}/social-posts/${ID}/statistics/refresh`, {}],
  ["PUT", `${P}/social-queue-slots`, { timezone: "UTC", slots: [] }],
  ["POST", `${P}/social-account-posts/${ID}/recycle`, {}],
];

async function call(
  method: string,
  path: string,
  authContext: AuthenticationContext,
  body?: object,
): Promise<Response> {
  const request = new Request(`https://core.example.test${path}`, {
    method,
    ...(body instanceof FormData
      ? { body }
      : body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
  });
  preAuthenticatedRequests.set(request, { isAuthenticated: true, authContext });
  return coreV1.fetch(request);
}

describe.each(CALLERS)("as %s", (_, authContext) => {
  it.each(OPENED_READS)("reads GET %s", async (path) => {
    const response = await call("GET", path, authContext);

    // 200 when the route needs no database, else the mock's 500.
    expect(
      [200, 500],
      `the guard should let the caller in: ${await response.text()}`,
    ).toContain(response.status);
  });

  it.each(HUMAN_ONLY_READS)("is refused GET %s", async (path) => {
    const response = await call("GET", path, authContext);

    expect(response.status).toBe(403);
  });

  it.each(HUMAN_ONLY_WRITES)("is refused %s %s", async (method, path, body) => {
    const response = await call(method, path, authContext, body);

    expect(response.status).toBe(403);
  });
});
