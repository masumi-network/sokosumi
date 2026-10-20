import { OpenAPIHono } from "@hono/zod-openapi";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mount from "./post";

const mocks = vi.hoisted(() => ({
  scope: vi.fn(),
  audience: vi.fn(),
  beta: vi.fn(),
  delegation: vi.fn(),
  capability: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { socialAccountPost: { update: mocks.update } },
}));
vi.mock("@/services/social-statistics-research.service", () => ({
  scopedXConnection: mocks.scope,
  readSocialPerformanceAudience: mocks.audience,
}));
vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: mocks.beta,
}));
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: mocks.delegation,
}));
vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: mocks.capability,
}));
const projectId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const postId = "44444444-4444-4444-8444-444444444444";
const auth: AuthenticationContext = {
  actor: "user",
  userId: "owner",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const url = `http://localhost/${projectId}/social-connections/${connectionId}/statistics/audience/export`;
const page = {
  kind: "followers",
  postId: null,
  contacts: [],
  posts: [],
  nextCursor: null,
  observedAt: "2026-10-08T12:00:00Z",
  samplePostCount: 0,
  oldestPostAt: null,
  newestPostAt: null,
  coverage: "Loaded page only; incomplete audience.",
};
const contact = {
  id: "123",
  name: "=2+2",
  username: "reader",
  description: "Public sample biography",
  location: "Self-reported location",
  avatarUrl: null,
  followersCount: 0,
  interactions: null,
  replies: null,
  quotes: null,
  mentions: null,
  likes: null,
  reposts: null,
};
const incoming = {
  author: {
    ...contact,
    description: "Incoming author biography",
    location: "Incoming author location",
  },
  interactionType: "mention",
  post: {
    id: postId,
    connectionId,
    provider: "x",
    externalId: "789",
    text: "Mention",
    publishedAt: "2026-10-08T11:00:00Z",
    url: "https://x.com/reader/status/789",
    metrics: {
      views: null,
      impressions: 0,
      likes: 0,
      comments: null,
      shares: null,
      saves: null,
    },
    additionalMetrics: [],
    fetchedAt: "2026-10-08T12:00:00Z",
  },
};
function createApp(actor = auth) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", actor);
    c.set("workspaceContext", {
      workspaceId,
      userId: "owner",
      organizationId: null,
    });
    await next();
  });
  mount(app);
  return app;
}
function request(body: unknown) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.beta.mockResolvedValue(undefined);
  mocks.scope.mockResolvedValue({
    account: { displayName: "Launch", externalHandle: "launch", provider: "x" },
  });
  mocks.capability.mockResolvedValue(undefined);
  mocks.delegation.mockRejectedValue(forbidden("Delegation required"));
});
describe("loaded X audience sample export", () => {
  it("scopes the selected account and exports submitted contacts without provider rereads or persistence", async () => {
    const response = await createApp().request(
      url,
      request({ format: "csv", pages: [{ ...page, contacts: [contact] }] }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="audience-followers-${connectionId}.csv"`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const csv = await response.text();
    expect(csv).toContain("Loaded page only; incomplete audience.");
    expect(csv).toContain("'=2+2");
    expect(csv).toContain("Launch");
    expect(csv).toContain("Bios and locations are left out by default");
    expect(csv).not.toContain(contact.description);
    expect(csv).not.toContain(contact.location);
    expect(mocks.scope).toHaveBeenCalledWith(
      { projectId, workspaceId, connectionId },
      undefined,
    );
    expect(mocks.audience).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["csv", "xlsx"])(
    "includes bios and locations in %s only with explicit boolean opt-in",
    async (format) => {
      for (const includeProfileDetails of [undefined, false, true]) {
        const response = await createApp().request(
          url,
          request({
            format,
            pages: [
              {
                ...page,
                kind: "mentions",
                contacts: [contact],
                posts: [incoming],
              },
            ],
            ...(includeProfileDetails === undefined
              ? {}
              : { includeProfileDetails }),
          }),
        );
        expect(response.status).toBe(200);
        let output: string;
        if (format === "csv") {
          output = await response.text();
        } else {
          const zip = await JSZip.loadAsync(await response.arrayBuffer());
          output = (
            await Promise.all(
              Object.values(zip.files)
                .filter((file) => file.name.endsWith(".xml"))
                .map((file) => file.async("string")),
            )
          ).join("\n");
        }
        expect(output.includes(contact.description)).toBe(
          includeProfileDetails === true,
        );
        expect(output.includes(contact.location)).toBe(
          includeProfileDetails === true,
        );
        expect(output).not.toContain("Incoming author biography");
        expect(output).not.toContain("Incoming author location");
      }
    },
  );
  it("returns an XLSX workbook with empty sample coverage", async () => {
    const response = await createApp().request(
      url,
      request({ format: "xlsx", pages: [page] }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    expect(await zip.file("xl/workbook.xml")?.async("string")).toContain(
      'name="Coverage"',
    );
    expect(
      await zip.file("xl/worksheets/sheet2.xml")?.async("string"),
    ).toContain("Loaded page only; incomplete audience.");
  });
  it("checks the cached own-post scope once for matching likers or reposters pages", async () => {
    const sample = { ...page, kind: "likers", postId };
    const response = await createApp().request(
      url,
      request({ format: "csv", pages: [sample, sample] }),
    );
    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledTimes(1);
    expect(mocks.scope).toHaveBeenCalledWith(
      { projectId, workspaceId, connectionId },
      postId,
    );
    mocks.scope.mockRejectedValue(
      notFound("Selected X post not found in this project account"),
    );
    expect(
      (
        await createApp().request(
          url,
          request({ format: "csv", pages: [sample] }),
        )
      ).status,
    ).toBe(404);
  });
  it("rejects empty, excessive, mixed-kind, mixed-post, missing-post and excessive-contact samples before scope reads", async () => {
    const samples = [
      [],
      Array.from({ length: 21 }, () => page),
      [page, { ...page, kind: "mentions" }],
      [
        { ...page, kind: "likers", postId },
        { ...page, kind: "likers", postId: connectionId },
      ],
      [{ ...page, kind: "likers" }],
      [{ ...page, postId }],
      [{ ...page, contacts: Array.from({ length: 101 }, () => contact) }],
      [
        {
          ...page,
          kind: "mentions",
          posts: Array.from({ length: 101 }, () => incoming),
        },
      ],
      [{ ...page, posts: [incoming] }],
    ];
    for (const pages of samples)
      expect(
        (await createApp().request(url, request({ format: "csv", pages })))
          .status,
      ).toBe(422);
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.audience).not.toHaveBeenCalled();
  });
  it("bounds JSON bytes before parsing or reading scope", async () => {
    const response = await createApp().request(
      url,
      request({
        format: "csv",
        pages: [{ ...page, coverage: "a".repeat(2 * 1024 * 1024) }],
      }),
    );
    expect(response.status).toBe(413);
    expect(mocks.scope).not.toHaveBeenCalled();
  });
  it("rejects invalid formats, non-boolean opt-ins and unknown body fields before scope reads", async () => {
    for (const body of [
      { format: "pdf", pages: [page] },
      { format: "csv", pages: [page], includeProfileDetails: "true" },
      { format: "csv", pages: [page], includeProfileDetails: null },
      { format: "csv", pages: [page], unexpected: true },
    ])
      expect((await createApp().request(url, request(body))).status).toBe(422);
    expect(mocks.scope).not.toHaveBeenCalled();
  });
  it("rejects incoming evidence from another connection after checking account scope", async () => {
    const response = await createApp().request(
      url,
      request({
        format: "csv",
        pages: [
          {
            ...page,
            kind: "mentions",
            posts: [
              {
                ...incoming,
                post: { ...incoming.post, connectionId: projectId },
              },
            ],
          },
        ],
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.scope).toHaveBeenCalledWith(
      { projectId, workspaceId, connectionId },
      undefined,
    );
    expect(mocks.audience).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("checks beta access and delegated Coworker authorization before scope verification", async () => {
    mocks.beta.mockRejectedValue(forbidden("Social unavailable"));
    expect(
      (
        await createApp().request(
          url,
          request({ format: "csv", pages: [page] }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.scope).not.toHaveBeenCalled();
    mocks.beta.mockResolvedValue(undefined);
    const actor: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker",
      vendorId: "vendor",
      context: { userId: "owner", organizationId: null },
    };
    const app = createApp(actor);
    expect(
      (await app.request(url, request({ format: "csv", pages: [page] })))
        .status,
    ).toBe(403);
    mocks.delegation.mockResolvedValue({
      userId: "owner",
      organizationId: null,
    });
    expect(
      (await app.request(url, request({ format: "csv", pages: [page] })))
        .status,
    ).toBe(200);
    expect(mocks.capability).toHaveBeenCalledWith(
      "coworker",
      "tasks",
      expect.anything(),
    );
  });
  it("rejects bot REST actors and human API keys", async () => {
    const bot: AuthenticationContext = {
      actor: "sokoBot",
      scope: "personal",
      sokoBotId: "bot",
      userId: "owner",
      workspaceId,
      organizationId: null,
    };
    const projectBot: AuthenticationContext = {
      actor: "sokoBot",
      scope: "project",
      sokoBotId: "project-bot",
      userId: null,
      workspaceId,
      organizationId: "organization",
      projectId,
    };
    for (const actor of [
      bot,
      projectBot,
      { ...auth, authenticationMethod: "api_key" } as const,
    ])
      expect(
        (
          await createApp(actor).request(
            url,
            request({ format: "csv", pages: [page] }),
          )
        ).status,
      ).toBe(403);
    expect(mocks.beta).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
  });
  it("preserves project access errors and maps unexpected failures without leaking details", async () => {
    for (const [error, status] of [
      [notFound("Project not found"), 404],
      [forbidden("Project access denied"), 403],
      [badRequest("Reconnect the X account"), 400],
      [new Error("access_token=secret"), 500],
    ] as const) {
      mocks.scope.mockRejectedValueOnce(error);
      const response = await createApp().request(
        url,
        request({ format: "csv", pages: [page] }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(await response.text()).not.toContain("secret");
    }
    expect(mocks.audience).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
