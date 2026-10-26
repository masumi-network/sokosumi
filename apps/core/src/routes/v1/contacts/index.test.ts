import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflict } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";

const { getSession, services, listServices, exportContactsCsv } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    services: {
      resolveContactActor: vi.fn(),
      inContactTransaction: vi.fn(),
      upsertContact: vi.fn(),
      updateContact: vi.fn(),
      listContacts: vi.fn(),
      mergeContacts: vi.fn(),
    },
    listServices: { createContactList: vi.fn() },
    exportContactsCsv: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/middleware/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/workspace")>();
  const { createMiddleware } = await import("hono/factory");
  return {
    ...actual,
    workspaceMiddleware: () =>
      createMiddleware(async (c, next) => {
        c.set("workspaceContext", {
          workspaceId: "0199f1c2-7a3b-7c1d-9e2f-000000000001",
          userId: "user_1",
          organizationId: null,
        });
        await next();
      }),
  };
});
vi.mock("@/services/contacts.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/contacts.service")>()),
  ...services,
}));
vi.mock("@/services/contact-lists.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/contact-lists.service")
  >()),
  ...listServices,
}));

vi.mock("@/services/contacts-import.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/contacts-import.service")
  >()),
  exportContactsCsv,
}));

const { default: contactsRouter } = await import("./index.js");
const { default: contactListsRouter } = await import(
  "../contact-lists/index.js"
);

const app = new Hono();
app.onError(errorHandler);
app.route("/contacts", contactsRouter);
app.route("/contact-lists", contactListsRouter);

const CONTACT_ID = "0199f1c2-7a3b-7c1d-9e2f-3a4b5c6d7e8f";
const NOW = "2026-10-22T10:00:00.000Z";
const CONTACT = {
  id: CONTACT_ID,
  name: "Nina Keller",
  organization: null,
  role: null,
  location: null,
  summary: null,
  whyInteresting: null,
  stage: "CONTACT",
  kind: "PERSON",
  owner: null,
  nextStep: null,
  followUpAt: null,
  avatarUrl: null,
  customFields: {},
  firstContactAt: null,
  lastContactAt: null,
  interactionCount: 0,
  lastInboundAt: null,
  awaitingReplySince: null,
  replyState: null,
  createdByUserId: "user_1",
  createdBySokoBotId: null,
  mergedIntoId: null,
  version: 1,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  channels: [],
  lists: [],
  knownBy: [],
  score: null,
};

function request(path: string, init: RequestInit = {}) {
  return app.request(`http://localhost${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function post(path: string, body: unknown) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({
    session: { activeOrganizationId: null },
    user: { id: "user_1", role: "user", banned: false },
  });
  services.resolveContactActor.mockResolvedValue({
    workspaceId: "0199f1c2-7a3b-7c1d-9e2f-000000000001",
    userId: "user_1",
    sokoBotId: null,
  });
  services.inContactTransaction.mockImplementation(
    (callback: (tx: unknown) => unknown) => callback({}),
  );
});

describe("contacts routes", () => {
  it("require a session", async () => {
    getSession.mockResolvedValue(null);
    for (const path of [
      "/contacts",
      "/contact-lists",
      `/contacts/${CONTACT_ID}`,
    ])
      expect((await request(path)).status).toBe(401);
    expect(services.listContacts).not.toHaveBeenCalled();
  });

  it("answer 422 for input the schema refuses", async () => {
    const invalid: [string, string, unknown][] = [
      ["POST", "/contacts", {}],
      [
        "POST",
        "/contacts",
        { name: "x", channels: [{ type: "FAX", value: "1" }] },
      ],
      ["PATCH", `/contacts/${CONTACT_ID}`, { name: "No version" }],
      ["PATCH", "/contacts/not-a-uuid", { version: 1 }],
      [
        "POST",
        "/contacts/merge",
        { winnerId: CONTACT_ID, loserIds: [CONTACT_ID] },
      ],
      [
        "POST",
        `/contacts/${CONTACT_ID}/interactions`,
        { occurredAt: "yesterday", channel: "EMAIL", summary: "Hi" },
      ],
      ["POST", "/contact-lists", { name: "VIP", color: "neon" }],
      ["POST", "/contact-lists", { name: "VIP", smartFilter: { unknown: 1 } }],
      ["POST", `/contact-lists/${CONTACT_ID}/members`, { add: [], remove: [] }],
    ];
    for (const [method, path, body] of invalid) {
      const response = await request(path, {
        method,
        body: JSON.stringify(body),
      });
      expect(response.status, `${method} ${path}`).toBe(422);
    }
    expect(services.upsertContact).not.toHaveBeenCalled();
    expect(listServices.createContactList).not.toHaveBeenCalled();
  });

  it("answers 201 for a new contact and 200 for an upsert onto an existing one", async () => {
    services.upsertContact.mockResolvedValueOnce({
      contact: CONTACT,
      created: true,
      changed: true,
      mergeSuggestion: null,
    });
    const created = await post("/contacts", {
      name: "Nina Keller",
      channels: [{ type: "EMAIL", value: "nina@example.com" }],
    });
    expect(created.status).toBe(201);
    expect(services.upsertContact).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "user_1" }),
      expect.objectContaining({ upsert: false, name: "Nina Keller" }),
    );

    services.upsertContact.mockResolvedValueOnce({
      contact: CONTACT,
      created: false,
      changed: false,
      mergeSuggestion: { reason: "shared_channel", contactIds: [CONTACT_ID] },
    });
    const upserted = await post("/contacts", {
      upsert: true,
      channels: [{ type: "EMAIL", value: "nina@example.com" }],
    });
    expect(upserted.status).toBe(200);
    expect((await upserted.json()).data.mergeSuggestion).toEqual({
      reason: "shared_channel",
      contactIds: [CONTACT_ID],
    });
  });

  it("names the contact that owns a taken channel", async () => {
    services.upsertContact.mockRejectedValueOnce(
      conflict("nina@example.com already belongs to another contact", {
        kind: "contact_channel_taken",
        extensions: { existingContactId: CONTACT_ID },
      }),
    );
    const response = await post("/contacts", {
      channels: [{ type: "EMAIL", value: "nina@example.com" }],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "contact_channel_taken",
      existingContactId: CONTACT_ID,
    });
  });

  it("turns list query params into a filter, and serves CSV", async () => {
    services.listContacts.mockResolvedValue({
      items: [CONTACT],
      total: 1,
      nextCursor: null,
    });
    const listId = "0199f1c2-7a3b-7c1d-9e2f-3a4b5c6d7e90";
    const response = await request(
      `/contacts?stage=INVESTOR&replyState=NO_REPLY&kind=PERSON&knownByMe=true&lastContactOlderThanDays=90&listId=${listId}&sort=lastContactAt&limit=5`,
    );
    expect(response.status).toBe(200);
    expect(services.listContacts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: expect.objectContaining({
          stages: ["INVESTOR"],
          replyStates: ["NO_REPLY"],
          kind: "PERSON",
          knownByMe: true,
          lastContactOlderThanDays: 90,
        }),
        listId,
        sort: "lastContactAt",
        limit: 5,
        archived: false,
      }),
    );
    const body = await response.json();
    expect(body.meta.pagination).toMatchObject({ total: 1, nextCursor: null });

    exportContactsCsv.mockResolvedValue('"Name"\r\n"Nina Keller"');
    const csv = await request("/contacts/export.csv?search=nina");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toMatch(
      /^attachment; filename="contacts-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(await csv.text()).toContain('"Nina Keller"');
    expect(exportContactsCsv).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: expect.objectContaining({ search: "nina" }),
      }),
    );
  });
});
