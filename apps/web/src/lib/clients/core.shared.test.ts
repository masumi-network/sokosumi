import {
  deleteAdminInvoice as coreDeleteAdminInvoice,
  getCoworkers as coreGetCoworkers,
  getCoworkersById as coreGetCoworkersById,
  getProjectsByIdClose as coreGetProjectsByIdClose,
  getUsersById as coreGetUsersById,
  getUsersByIdSignUp as coreGetUsersByIdSignUp,
  getWorkspacesCalendarSources as coreGetWorkspacesCalendarSources,
  postProjectsByIdClose as corePostProjectsByIdClose,
  postProjectsByIdCloseCancelOwed as corePostProjectsByIdCloseCancelOwed,
  postProjectsByIdCloseRetry as corePostProjectsByIdCloseRetry,
  startAdminImpersonation as coreStartAdminImpersonation,
  stopAdminImpersonation as coreStopAdminImpersonation,
} from "@sokosumi/core-client";
import { type Client, createClient } from "@sokosumi/core-client/client";
import { describe, expect, it, vi } from "vitest";
import { createCoreClient } from "@/lib/clients/core.shared";
import {
  NEWSLETTER_ANALYTICS,
  NEWSLETTER_ISSUE,
  PUBLIC_NEWSLETTER,
  PUBLIC_NEWSLETTER_ISSUE,
  PUBLIC_NEWSLETTER_ISSUE_SUMMARY,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

vi.mock("@sokosumi/core-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sokosumi/core-client")>();
  return {
    ...actual,
    deleteAdminInvoice: vi.fn(),
    getCoworkers: vi.fn(),
    getCoworkersById: vi.fn(),
    getProjectsByIdClose: vi.fn(),
    getUsersById: vi.fn(),
    getUsersByIdSignUp: vi.fn(),
    getWorkspacesCalendarSources: vi.fn(),
    postProjectsByIdClose: vi.fn(),
    postProjectsByIdCloseCancelOwed: vi.fn(),
    postProjectsByIdCloseRetry: vi.fn(),
    startAdminImpersonation: vi.fn(),
    stopAdminImpersonation: vi.fn(),
  };
});

describe("createCoreClient public newsletter reads", () => {
  it("posts selected contacts, lists and consent to the generated Contacts operation", async () => {
    const requests: Request[] = [];
    const summary = {
      added: 1,
      alreadySubscribed: 2,
      skippedUnsubscribed: 3,
      skippedBounced: 4,
      skippedNoEmail: 5,
      pendingConfirmation: 6,
    };
    const client = createClient({
      baseUrl: "https://core.example.com/v1",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(
          JSON.stringify({
            data: summary,
            meta: { requestId: "test", timestamp: new Date() },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    const core = createCoreClient(() => client);
    const body = {
      contactIds: ["c1"],
      listIds: ["l1"],
      consent: "ASK" as const,
    };
    expect(
      (await core.postProjectsByIdNewsletterSubscribersFromContacts("p1", body))
        .data,
    ).toEqual(summary);
    expect(requests[0].url).toBe(
      "https://core.example.com/v1/projects/p1/newsletter/subscribers/from-contacts",
    );
    expect(requests[0].method).toBe("POST");
    expect(await requests[0].json()).toEqual(body);
  });

  it("uses the generated subscribe operation and preserves its generic 202 response", async () => {
    const requests: Request[] = [];
    const client = createClient({
      baseUrl: "https://core.example.com/v1",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ status: "check_your_inbox" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const core = createCoreClient(() => client);
    const input = {
      email: "reader@example.com",
      name: "Ada",
      source: "SIGNUP_FORM",
      website: "",
      locale: "de",
    } as const;
    expect(
      await core.postPublicNewslettersByPublicSlugSubscribe(
        PUBLIC_NEWSLETTER_SLUG,
        input,
        { "x-forwarded-for": "203.0.113.4" },
      ),
    ).toEqual({ status: "check_your_inbox" });
    const request = requests[0];
    expect(request.url).toBe(
      `https://core.example.com/v1/public/newsletters/${PUBLIC_NEWSLETTER_SLUG}/subscribe`,
    );
    expect(request.method).toBe("POST");
    expect(request.cache).toBe("no-store");
    expect(request.headers.get("x-forwarded-for")).toBe("203.0.113.4");
    expect(await request.json()).toEqual(input);
  });

  it("uses generated public routes with no-store and transforms issue dates", async () => {
    const meta = {
      requestId: "public_test",
      timestamp: new Date(),
      pagination: { cursor: null, limit: 20, total: 1, nextCursor: null },
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const { pathname } = new URL(new Request(input, init).url);
        const data = pathname.endsWith("/issues/hello")
          ? PUBLIC_NEWSLETTER_ISSUE
          : pathname.endsWith("/issues")
            ? [PUBLIC_NEWSLETTER_ISSUE_SUMMARY]
            : PUBLIC_NEWSLETTER;
        return new Response(JSON.stringify({ data, meta }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const client = createClient({
      baseUrl: "https://core.example.com/v1",
      fetch: fetchMock,
    });
    const core = createCoreClient(() => client);
    expect(
      (await core.getPublicNewslettersByPublicSlug(PUBLIC_NEWSLETTER_SLUG))
        .data,
    ).toEqual(PUBLIC_NEWSLETTER);
    const page = await core.getPublicNewslettersByPublicSlugIssues(
      PUBLIC_NEWSLETTER_SLUG,
      { limit: 1 },
    );
    expect(page.data[0].sentAt).toEqual(PUBLIC_NEWSLETTER_ISSUE.sentAt);
    expect(page.meta.pagination.nextCursor).toBeNull();
    const issue = await core.getPublicNewslettersByPublicSlugIssuesByIssueSlug(
      PUBLIC_NEWSLETTER_SLUG,
      "hello",
      "es",
    );
    expect(issue.data).toEqual(PUBLIC_NEWSLETTER_ISSUE);
    const requests = fetchMock.mock.calls.map(
      ([input, init]) => new Request(input, init),
    );
    expect(requests.map((request) => request.url)).toEqual([
      `https://core.example.com/v1/public/newsletters/${PUBLIC_NEWSLETTER_SLUG}`,
      `https://core.example.com/v1/public/newsletters/${PUBLIC_NEWSLETTER_SLUG}/issues?limit=1`,
      `https://core.example.com/v1/public/newsletters/${PUBLIC_NEWSLETTER_SLUG}/issues/hello?locale=es`,
    ]);
    for (const request of requests) {
      expect(request.cache).toBe("no-store");
      expect(request.headers.get("authorization")).toBeNull();
    }
  });

  it("preserves public 404s for the service to map to notFound", async () => {
    const client = createClient({
      baseUrl: "https://core.example.com/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: "Not Found",
            message: "Newsletter not found",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
    });
    const core = createCoreClient(() => client);
    await expect(
      core.getPublicNewslettersByPublicSlug("missing"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      core.getPublicNewslettersByPublicSlugIssues("missing", {}),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      core.getPublicNewslettersByPublicSlugIssuesByIssueSlug(
        "missing",
        "hello",
        "en",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("createCoreClient newsletter analytics", () => {
  it("preserves calendar dates, transforms issue timestamps and bypasses shared caches", async () => {
    const requests: Request[] = [];
    const client = createClient({
      baseUrl: "https://core.example.com/v1",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const data = new URL(request.url).pathname.includes("/issues/")
          ? {
              totals: NEWSLETTER_ANALYTICS.totals,
              topLinks: [{ url: "https://example.com/read", uniqueClicks: 2 }],
            }
          : NEWSLETTER_ANALYTICS;
        return new Response(
          JSON.stringify({
            data,
            meta: { timestamp: "2026-10-02T12:00:00Z", requestId: "analytics" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    const core = createCoreClient(() => client);
    const response = await core.getProjectsByIdNewsletterAnalytics(
      NEWSLETTER_ISSUE.projectId,
      { from: "2026-10-01", to: "2026-10-02" },
    );
    expect(response.data).toEqual(NEWSLETTER_ANALYTICS);
    expect(response.data.from).toBe("2026-10-01");
    expect(response.data.subscriberGrowth[0]?.date).toBe("2026-10-01");
    expect(response.data.issues[0]?.sentAt).toBeInstanceOf(Date);
    const issue = await core.getProjectsByIdNewsletterIssuesByIssueIdAnalytics(
      NEWSLETTER_ISSUE.projectId,
      NEWSLETTER_ISSUE.id,
    );
    expect(issue.data.topLinks).toEqual([
      { url: "https://example.com/read", uniqueClicks: 2 },
    ]);
    expect(requests.map((request) => request.url)).toEqual([
      `https://core.example.com/v1/projects/${NEWSLETTER_ISSUE.projectId}/newsletter/analytics?from=2026-10-01&to=2026-10-02`,
      `https://core.example.com/v1/projects/${NEWSLETTER_ISSUE.projectId}/newsletter/issues/${NEWSLETTER_ISSUE.id}/analytics`,
    ]);
    for (const request of requests) expect(request.cache).toBe("no-store");
  });
});

describe("createCoreClient calendar sources", () => {
  it("forwards Social scope without caching workspace data", async () => {
    vi.mocked(coreGetWorkspacesCalendarSources).mockResolvedValue({
      data: { data: [], meta: { timestamp: new Date(), requestId: "req_1" } },
      response: new Response(null, { status: 200 }),
    });
    const client = createClient();
    const core = createCoreClient(async () => client);
    const query = { includeSocialPosts: "true", scope: "owned" } as const;

    await core.getWorkspaceCalendarSources(query);

    expect(coreGetWorkspacesCalendarSources).toHaveBeenCalledWith({
      client,
      query,
      cache: "no-store",
    });
  });
});

describe("createCoreClient no-content responses", () => {
  it("treats 204 responses with undefined data as success", async () => {
    vi.mocked(coreDeleteAdminInvoice).mockResolvedValue({
      data: undefined,
      response: { ok: true, status: 204 } as Response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.deleteAdminInvoice("in_1")).resolves.toBeUndefined();
  });
});

describe("createCoreClient owned coworkers", () => {
  it("requests owned scope with no-store caching", async () => {
    vi.mocked(coreGetCoworkers).mockResolvedValue({
      data: { data: [], meta: { timestamp: new Date(), requestId: "req_1" } },
      response: { ok: true, status: 200 } as Response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    await core.getOwnedCoworkers();

    expect(coreGetCoworkers).toHaveBeenCalledWith({
      client: {},
      query: { scope: "owned" },
      cache: "no-store",
    });
  });

  it("requests owned coworker by id with no-store caching", async () => {
    vi.mocked(coreGetCoworkersById).mockResolvedValue({
      data: {
        data: { id: "cow_1" },
        meta: { timestamp: new Date(), requestId: "req_1" },
      },
      response: { ok: true, status: 200 } as Response,
    } as never);

    const core = createCoreClient(async () => ({}) as Client);

    await core.getOwnedCoworkerById("cow_1");

    expect(coreGetCoworkersById).toHaveBeenCalledWith({
      client: {},
      path: { id: "cow_1" },
      query: { scope: "owned" },
      cache: "no-store",
    });
  });
});

describe("createCoreClient project close lifecycle", () => {
  const status = {
    id: "123e4567-e89b-42d3-a456-426614174001",
    projectId: "123e4567-e89b-42d3-a456-426614174002",
    state: "CLOSING" as const,
    cutoffAt: new Date("2026-09-14T10:00:00.000Z"),
    reason: null,
    attempts: 0,
    failure: null,
    completedAt: null,
    projectRevision: 4,
    owedOccurrenceCount: 2,
  };

  it("reads close status without caching", async () => {
    vi.mocked(coreGetProjectsByIdClose).mockResolvedValue({
      data: { data: status },
      response: { ok: true, status: 200 } as Response,
    } as never);
    const core = createCoreClient(async () => ({}) as Client);

    await core.getProjectsByIdClose(status.projectId);

    expect(coreGetProjectsByIdClose).toHaveBeenCalledWith({
      client: {},
      path: { id: status.projectId },
      cache: "no-store",
    });
  });

  it("sends close and recovery bodies unchanged", async () => {
    for (const mutation of [
      corePostProjectsByIdClose,
      corePostProjectsByIdCloseRetry,
      corePostProjectsByIdCloseCancelOwed,
    ]) {
      vi.mocked(mutation).mockResolvedValue({
        data: { data: status },
        response: { ok: true, status: 200 } as Response,
      } as never);
    }
    const core = createCoreClient(async () => ({}) as Client);
    const closeBody = {
      operationId: "123e4567-e89b-42d3-a456-426614174003",
      expectedProjectRevision: 3,
      reason: "Campaign complete",
    };
    const recoveryBody = {
      operationId: "123e4567-e89b-42d3-a456-426614174004",
      expectedProjectRevision: 4,
      reason: "Reviewed the blocked series",
    };

    await core.postProjectsByIdClose(status.projectId, closeBody);
    await core.postProjectsByIdCloseRetry(status.projectId, recoveryBody);
    await core.postProjectsByIdCloseCancelOwed(status.projectId, recoveryBody);

    expect(corePostProjectsByIdClose).toHaveBeenCalledWith(
      expect.objectContaining({
        client: {},
        path: { id: status.projectId },
        body: closeBody,
      }),
    );
    expect(corePostProjectsByIdCloseRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        client: {},
        path: { id: status.projectId },
        body: recoveryBody,
      }),
    );
    expect(corePostProjectsByIdCloseCancelOwed).toHaveBeenCalledWith(
      expect.objectContaining({
        client: {},
        path: { id: status.projectId },
        body: recoveryBody,
      }),
    );
  });
});

describe("createCoreClient impersonation", () => {
  it("starts an impersonation and keeps the response for cookie reads", async () => {
    const response = new Response(null, { status: 201 });
    response.headers.append("set-cookie", "session_token=abc; Path=/");
    vi.mocked(coreStartAdminImpersonation).mockResolvedValue({
      data: {
        data: { id: "user_target", name: "T", email: "t@example.com" },
        meta: { timestamp: new Date(), requestId: "req_1" },
      },
      response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    const result = await core.startAdminImpersonation({
      userId: "user_target",
      reason: "SOK-1: x",
    });

    expect(coreStartAdminImpersonation).toHaveBeenCalledWith({
      client: {},
      body: { userId: "user_target", reason: "SOK-1: x" },
      cache: "no-store",
    });
    expect(result.data.data).toEqual({
      id: "user_target",
      name: "T",
      email: "t@example.com",
    });
    expect(result.response).toBe(response);
  });

  it("stops an impersonation and keeps the response for cookie reads", async () => {
    const response = new Response(null, { status: 200 });
    vi.mocked(coreStopAdminImpersonation).mockResolvedValue({
      data: {
        data: { id: "user_admin", name: "A", email: "a@example.com" },
        meta: { timestamp: new Date(), requestId: "req_1" },
      },
      response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    const result = await core.stopAdminImpersonation();

    expect(coreStopAdminImpersonation).toHaveBeenCalledWith({
      client: {},
      cache: "no-store",
    });
    expect(result.data.data).toEqual({
      id: "user_admin",
      name: "A",
      email: "a@example.com",
    });
    expect(result.response).toBe(response);
  });
});

/** A Core error result as the generated client resolves it. */
function coreErrorResult(status: number, error: string) {
  return {
    data: undefined,
    error: {
      error,
      message: error,
      meta: {
        timestamp: new Date(),
        requestId: "req_1",
        path: "/",
        method: "GET",
      },
    },
    response: new Response(null, { status }),
  };
}

describe("createCoreClient user by id", () => {
  it("returns null when no user matches", async () => {
    vi.mocked(coreGetUsersById).mockResolvedValue(
      coreErrorResult(404, "Not Found"),
    );

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.getUserById("user_gone")).resolves.toBeNull();
    expect(coreGetUsersById).toHaveBeenCalledWith({
      client: {},
      path: { id: "user_gone" },
      cache: "no-store",
    });
  });

  it("returns the user", async () => {
    const user = { id: "user_1", email: "ada@example.com" };
    vi.mocked(coreGetUsersById).mockResolvedValue({
      data: {
        data: user,
        meta: { timestamp: new Date(), requestId: "r" },
      } as never,
      response: { ok: true, status: 200 } as Response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.getUserById("user_1")).resolves.toEqual(user);
  });

  it("rethrows errors other than a missing user", async () => {
    vi.mocked(coreGetUsersById).mockResolvedValue(
      coreErrorResult(403, "Forbidden"),
    );

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.getUserById("user_x")).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("createCoreClient user sign-up", () => {
  it("returns null when Core has no sign-up recorded for the user", async () => {
    vi.mocked(coreGetUsersByIdSignUp).mockResolvedValue(
      coreErrorResult(404, "Not Found"),
    );

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.getUserSignUp("user_old")).resolves.toBeNull();
    expect(coreGetUsersByIdSignUp).toHaveBeenCalledWith({
      client: {},
      path: { id: "user_old" },
      cache: "no-store",
    });
  });

  it("returns the recorded sign-up", async () => {
    const signUp = {
      origin: "cmo",
      context: { campaign: "https://example.com/launch", seats: 3 },
      createdAt: new Date("2026-10-07T12:00:00.000Z"),
    };
    vi.mocked(coreGetUsersByIdSignUp).mockResolvedValue({
      data: { data: signUp, meta: { timestamp: new Date(), requestId: "r" } },
      response: { ok: true, status: 200 } as Response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.getUserSignUp("user_new")).resolves.toEqual(signUp);
  });

  it("rethrows errors other than a missing record", async () => {
    vi.mocked(coreGetUsersByIdSignUp).mockResolvedValue(
      coreErrorResult(403, "Forbidden"),
    );

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.getUserSignUp("user_x")).rejects.toMatchObject({
      status: 403,
    });
  });
});
