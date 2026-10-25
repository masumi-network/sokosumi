/**
 * The contacts API end to end on PostgreSQL: workspace membership is the gate,
 * a contact or list of another workspace is a 404, and the HTTP shapes
 * (status codes, error kinds) come from the real services.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { default: contactsRouter } = await import("./index.js");
const { default: contactListsRouter } = await import(
  "../contact-lists/index.js"
);

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const member = randomUUID();
const stranger = randomUUID();
const workspaceId = randomUUID();
const strangerWorkspaceId = randomUUID();

function appFor(userId: string, workspace: string) {
  const auth: AuthenticationContext = {
    actor: "user",
    userId,
    organizationId: null,
    role: "user",
    authenticationMethod: "session",
  };
  const context: WorkspaceContext = {
    workspaceId: workspace,
    userId,
    organizationId: null,
  };
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    c.set("workspaceContext", context);
    c.set("requestId", "req_contacts");
    await next();
  });
  app.route("/contacts", contactsRouter);
  app.route("/contact-lists", contactListsRouter);
  return (method: string, path: string, body?: unknown) =>
    app.request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

describe.runIf(enabled)("contacts API on PostgreSQL", () => {
  const call = appFor(member, workspaceId);
  const strangerCall = appFor(stranger, strangerWorkspaceId);
  // A caller who names somebody else's workspace: the router resolves the
  // workspace from the caller itself, so the claim gets them nothing.
  const intruderCall = appFor(stranger, workspaceId);

  beforeAll(async () => {
    for (const id of [member, stranger])
      await prisma.user.create({
        data: {
          id,
          name: id === member ? "Member" : "Stranger",
          email: `contacts-api-${id}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await prisma.workspace.create({
      data: { id: workspaceId, userId: member },
    });
    await prisma.workspace.create({
      data: { id: strangerWorkspaceId, userId: stranger },
    });
  });

  afterAll(async () => {
    const workspaces = { in: [workspaceId, strangerWorkspaceId] };
    await prisma.contactList.deleteMany({ where: { workspaceId: workspaces } });
    await prisma.contact.deleteMany({ where: { workspaceId: workspaces } });
    await prisma.workspace.deleteMany({ where: { id: workspaces } });
    await prisma.user.deleteMany({ where: { id: { in: [member, stranger] } } });
  });

  it("creates, reads, edits, lists and exports through HTTP", async () => {
    const created = await call("POST", "/contacts", {
      name: "Grace Hopper",
      organization: "Navy",
      channels: [{ type: "EMAIL", value: "Grace@Navy.test" }],
    });
    expect(created.status).toBe(201);
    const contact = (await created.json()).data.contact;
    expect(contact.channels[0].value).toBe("grace@navy.test");

    const taken = await call("POST", "/contacts", {
      name: "G. Hopper",
      channels: [{ type: "EMAIL", value: "grace@navy.test" }],
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      kind: "contact_channel_taken",
      existingContactId: contact.id,
    });

    const invalid = await call("POST", "/contacts", {
      channels: [{ type: "EMAIL", value: "not an address" }],
    });
    expect(invalid.status).toBe(422);

    const patched = await call("PATCH", `/contacts/${contact.id}`, {
      version: contact.version,
      stage: "PARTNER",
      nextStep: "Send the deck",
    });
    expect(patched.status).toBe(200);
    const stale = await call("PATCH", `/contacts/${contact.id}`, {
      version: contact.version,
      stage: "DORMANT",
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).kind).toBe("contact_version_conflict");

    const logged = await call("POST", `/contacts/${contact.id}/interactions`, {
      occurredAt: "2026-10-01T09:00:00+02:00",
      channel: "MEETING",
      summary: "Compiler roadmap",
      sourceRef: "cal-1",
    });
    expect(logged.status).toBe(201);
    const replay = await call("POST", `/contacts/${contact.id}/interactions`, {
      occurredAt: "2026-10-01T09:00:00+02:00",
      channel: "MEETING",
      summary: "Compiler roadmap",
      sourceRef: "cal-1",
    });
    expect(replay.status).toBe(200);

    const list = await call("POST", "/contact-lists", {
      name: "Pioneers",
      color: "teal",
    });
    expect(list.status).toBe(201);
    const listId = (await list.json()).data.id;
    const members = await call("POST", `/contact-lists/${listId}/members`, {
      add: [contact.id],
    });
    expect((await members.json()).data.count).toBe(1);

    const page = await call("GET", `/contacts?listId=${listId}&limit=10`);
    const body = await page.json();
    expect(body.data.map((entry: { id: string }) => entry.id)).toEqual([
      contact.id,
    ]);
    expect(body.meta.pagination.total).toBe(1);

    const detail = await (await call("GET", `/contacts/${contact.id}`)).json();
    expect(detail.data).toMatchObject({
      stage: "PARTNER",
      interactionCount: 1,
      lastContactAt: "2026-10-01T07:00:00.000Z",
      knownBy: [{ id: member, name: "Member" }],
      lists: [{ id: listId, name: "Pioneers", color: "teal" }],
    });
    expect(detail.data.recentInteractions).toHaveLength(1);

    const activity = await (
      await call("GET", `/contacts/${contact.id}/activity`)
    ).json();
    expect(activity.data.map((entry: { kind: string }) => entry.kind)).toEqual([
      "UPDATED",
      "CREATED",
    ]);

    const csv = await call("GET", `/contacts/export.csv?listId=${listId}`);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect((await csv.text()).split("\r\n")[1]).toContain('"Grace Hopper"');

    const archived = await call("POST", `/contacts/${contact.id}/archive`);
    expect((await archived.json()).data.archivedAt).not.toBeNull();
    const live = await (await call("GET", "/contacts")).json();
    expect(live.meta.pagination.total).toBe(0);
    const archivedList = await (
      await call("GET", "/contacts?archived=true")
    ).json();
    expect(archivedList.meta.pagination.total).toBe(1);
  });

  it("groups a company's spellings and email domain, and filters by it", async () => {
    const people: [string, string | null, string][] = [
      ["Ada Org", "Analytical Engines", "ada@engines.test"],
      ["Babbage Org", "Analytical Engines", "babbage@engines.test"],
      ["Charles Org", "analytical engines ", "charles@other.test"],
      ["Grace Org", "Analytical Engines Ltd", "grace@engines.test"],
      ["Hopper Org", null, "hopper@engines.test"],
      ["Navy Org", "US Navy", "navy@gmail.com"],
      ["Free Org", null, "free@gmail.com"],
      ["Lone Org", "50% Solo_Co", "lone@solo.test"],
    ];
    for (const [name, organization, email] of people)
      await call("POST", "/contacts", {
        name,
        organization,
        channels: [{ type: "EMAIL", value: email }],
      });

    const companies = (
      await (await call("GET", "/contacts/organizations?search=engines")).json()
    ).data;
    expect(companies).toEqual([{ name: "Analytical Engines", count: 5 }]);
    // `%` and `_` in a search are literal, not wildcards.
    const literal = (
      await (
        await call("GET", "/contacts/organizations?search=50%25%20S")
      ).json()
    ).data;
    expect(literal).toEqual([{ name: "50% Solo_Co", count: 1 }]);
    expect(
      (await (await strangerCall("GET", "/contacts/organizations")).json())
        .data,
    ).toEqual([]);

    for (const company of ["ANALYTICAL ENGINES", "Analytical Engines Ltd"]) {
      const at = await (
        await call(
          "GET",
          `/contacts?company=${encodeURIComponent(company)}&sort=name`,
        )
      ).json();
      expect(at.data.map((contact: { name: string }) => contact.name)).toEqual([
        "Ada Org",
        "Babbage Org",
        "Charles Org",
        "Grace Org",
        "Hopper Org",
      ]);
    }
    // A free-mail domain makes nobody colleagues.
    const navy = await (
      await call("GET", "/contacts?company=US%20Navy")
    ).json();
    expect(navy.data.map((contact: { name: string }) => contact.name)).toEqual([
      "Navy Org",
    ]);
  });

  it("lists the people I have talked to as mine", async () => {
    const post = async (body: object) =>
      (await (await call("POST", "/contacts", body)).json()).data.contact;
    const talked = await post({ name: "Mine Talked" });
    await post({ name: "Not Mine" });
    const logged = await call("POST", `/contacts/${talked.id}/interactions`, {
      occurredAt: new Date().toISOString(),
      channel: "EMAIL",
      summary: "Intro call",
    });
    expect(logged.status).toBe(201);

    const mine = await (
      await call("GET", "/contacts?knownByMe=true&search=Mine&sort=name")
    ).json();
    expect(mine.data.map((contact: { name: string }) => contact.name)).toEqual([
      "Mine Talked",
    ]);
  });

  it("hides one workspace's contacts and lists from another", async () => {
    const created = await call("POST", "/contacts", {
      name: "Private To Member",
    });
    const { contact } = (await created.json()).data;
    const list = (
      await (
        await call("POST", "/contact-lists", { name: "Member list" })
      ).json()
    ).data;

    for (const [method, path, body] of [
      ["GET", `/contacts/${contact.id}`, undefined],
      ["PATCH", `/contacts/${contact.id}`, { version: 1, name: "Stolen" }],
      ["GET", `/contacts/${contact.id}/interactions`, undefined],
      [
        "POST",
        `/contacts/${contact.id}/channels`,
        { type: "EMAIL", value: "x@y.test" },
      ],
      ["POST", `/contacts/${contact.id}/archive`, undefined],
      ["PATCH", `/contact-lists/${list.id}`, { name: "Stolen" }],
      ["DELETE", `/contact-lists/${list.id}`, undefined],
      ["GET", `/contacts?listId=${list.id}`, undefined],
    ] as const) {
      const response = await strangerCall(method, path, body);
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const merge = await strangerCall("POST", "/contacts/merge", {
      winnerId: contact.id,
      loserIds: [randomUUID()],
    });
    expect(merge.status).toBe(404);
    expect(
      (await (await strangerCall("GET", "/contacts")).json()).meta.pagination
        .total,
    ).toBe(0);
    expect(
      (await (await strangerCall("GET", "/contact-lists")).json()).data,
    ).toEqual([]);

    expect(
      (await (await intruderCall("GET", "/contacts")).json()).meta.pagination
        .total,
    ).toBe(0);
    expect((await intruderCall("GET", `/contacts/${contact.id}`)).status).toBe(
      404,
    );
  });
});
