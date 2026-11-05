import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflict } from "@/helpers/error";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  receipt: vi.fn(),
  listContacts: vi.fn(),
  getContactDetail: vi.fn(),
  upsertContact: vi.fn(),
  updateContact: vi.fn(),
  addContactChannel: vi.fn(),
  setContactArchived: vi.fn(),
  logContactInteraction: vi.fn(),
  mergeContacts: vi.fn(),
  createContactList: vi.fn(),
  updateContactListMembers: vi.fn(),
}));
const tx = {
  sokoBotToolCall: { update: mocks.receipt },
  sokoBotTurn: { findUnique: vi.fn().mockResolvedValue(null) },
};
vi.mock("@/lib/db/prisma", () => ({
  default: { workspace: { findFirst: mocks.workspace } },
}));
vi.mock("@/services/contacts.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/contacts.service")>()),
  inContactTransaction: (run: (client: typeof tx) => unknown) => run(tx),
  listContacts: mocks.listContacts,
  getContactDetail: mocks.getContactDetail,
  upsertContact: mocks.upsertContact,
  updateContact: mocks.updateContact,
  addContactChannel: mocks.addContactChannel,
  setContactArchived: mocks.setContactArchived,
  logContactInteraction: mocks.logContactInteraction,
  mergeContacts: mocks.mergeContacts,
}));
vi.mock("@/services/contact-lists.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/contact-lists.service")
  >()),
  createContactList: mocks.createContactList,
  updateContactListMembers: mocks.updateContactListMembers,
}));

import { SokoBotRuntimeService } from "../soko-bot-runtime.service";

const userId = randomUUID();
const workspaceId = randomUUID();
const sokoBotId = randomUUID();
const turnId = randomUUID();
const contactId = randomUUID();
const listId = randomUUID();
const actor = { workspaceId, userId, sokoBotId };
const authorized: AuthorizedSokoBotRuntime = {
  toolCallLimit: 64,
  turn: {
    id: turnId,
    actingUserId: userId,
    requestedByUserId: userId,
    workspaceId,
    sokoBotId,
    eveSessionId: "contacts-test",
    versionId: null,
    source: "CHAT",
    chainDepth: 0,
  },
  classificationConfidence: 1,
  reader: { userId, audience: undefined, sharedScope: null },
  grant: {
    userId,
    workspaceId,
    sokoBotId,
    issuer: "test",
    audience: "test",
    subject: sokoBotId,
    jwtId: randomUUID(),
    sessionId: "contacts-test",
    turnId,
    contextSnapshotId: randomUUID(),
    memoryRevisionId: null,
    memoryVersion: 0,
    capabilities: [],
    issuedAt: 0,
    expiresAt: 9999999999,
  },
};

const contact = { id: contactId, name: "Nina Keller", version: 2 };

function runtime() {
  const service = new SokoBotRuntimeService();
  vi.spyOn(service, "authorize").mockResolvedValue(authorized);
  const authority = vi.fn().mockResolvedValue({ id: workspaceId });
  service["requireMutationAuthority"] = authority;
  const run = (capability: string, input: unknown) =>
    service["executeAuthorizedTool"]({
      turnId,
      toolCallId: "call_1",
      capability,
      input,
    } as never);
  return { run, authority };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({ id: workspaceId, organizationId: null });
  mocks.receipt.mockImplementation(async ({ data }) => ({
    id: "receipt",
    capability: "upsert_contact",
    ...data,
  }));
});

describe("Soko Bot contacts tools", () => {
  it("search as the turn's member without a receipt", async () => {
    mocks.listContacts.mockResolvedValue({
      items: [contact],
      total: 1,
      nextCursor: null,
    });
    const { run, authority } = runtime();
    expect(
      await run("search_contacts", { search: "nina", stages: ["LEAD"] }),
    ).toEqual({ contacts: [contact], total: 1, nextCursor: null });
    expect(mocks.listContacts).toHaveBeenCalledWith(actor, {
      filter: { search: "nina", stages: ["LEAD"] },
      listId: undefined,
      archived: undefined,
      sort: "lastContactAt",
      direction: undefined,
      cursor: undefined,
      limit: 25,
    });
    expect(authority).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it("refuses a turn whose member lost the workspace", async () => {
    mocks.workspace.mockResolvedValue(null);
    const { run } = runtime();
    await expect(run("get_contact", { contactId })).rejects.toThrow(
      /Workspace access is no longer available/,
    );
    expect(mocks.getContactDetail).not.toHaveBeenCalled();
  });

  it("always upserts, and commits the receipt with the change", async () => {
    mocks.upsertContact.mockResolvedValue({
      contact,
      created: false,
      changed: true,
      mergeSuggestion: null,
    });
    const { run, authority } = runtime();
    await run("upsert_contact", {
      name: "Nina Keller",
      channels: [{ type: "EMAIL", value: "nina@example.com" }],
    });
    expect(authority).toHaveBeenCalledWith(
      tx,
      authorized,
      false,
      "upsert_contact",
    );
    expect(mocks.upsertContact).toHaveBeenCalledWith(
      tx,
      actor,
      expect.objectContaining({ upsert: true, name: "Nina Keller" }),
    );
    expect(mocks.receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          turnId_toolCallId: { turnId, toolCallId: "call_1" },
        }),
        data: expect.objectContaining({
          status: "COMPLETED",
          verification: "LOCAL_TRANSACTION",
          actorBotId: sokoBotId,
          targetId: contactId,
        }),
      }),
    );
  });

  it("applies fields, channels and archive in one change, under one receipt", async () => {
    mocks.updateContact.mockResolvedValue({ ...contact, version: 3 });
    mocks.addContactChannel.mockResolvedValue({ ...contact, version: 4 });
    mocks.setContactArchived.mockResolvedValue({ ...contact, version: 5 });
    const { run } = runtime();
    const result = await run("update_contact", {
      contactId,
      version: 2,
      stage: "ACTIVE",
      addChannels: [{ type: "X", value: "@nina" }],
      archived: true,
    });
    expect(mocks.updateContact).toHaveBeenCalledWith(tx, actor, contactId, {
      stage: "ACTIVE",
      version: 2,
    });
    expect(mocks.addContactChannel).toHaveBeenCalledWith(tx, actor, contactId, {
      type: "X",
      value: "@nina",
    });
    expect(mocks.setContactArchived).toHaveBeenCalledWith(
      tx,
      actor,
      contactId,
      true,
    );
    expect(result).toMatchObject({ version: 5 });
    expect(mocks.receipt).toHaveBeenCalledTimes(1);
  });

  it("writes no receipt when the change is refused", async () => {
    mocks.updateContact.mockRejectedValue(
      conflict("This contact changed. Reload it and try again.", {
        kind: "contact_version_conflict",
      }),
    );
    const { run } = runtime();
    await expect(
      run("update_contact", { contactId, version: 1, stage: "ACTIVE" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it("logs interactions against the contact", async () => {
    mocks.logContactInteraction.mockResolvedValue({
      interaction: { id: "i1" },
      created: true,
    });
    const { run } = runtime();
    await run("log_contact_interaction", {
      contactId,
      occurredAt: "2026-10-22T10:00:00Z",
      channel: "EMAIL",
      summary: "Pricing for the Q3 pilot",
      sourceRef: "msg_1",
    });
    expect(mocks.logContactInteraction).toHaveBeenCalledWith(
      tx,
      actor,
      contactId,
      {
        occurredAt: "2026-10-22T10:00:00Z",
        channel: "EMAIL",
        summary: "Pricing for the Q3 pilot",
        sourceRef: "msg_1",
      },
    );
    expect(mocks.receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetId: contactId }),
      }),
    );
  });

  it("creates lists and changes members through one tool", async () => {
    mocks.createContactList.mockResolvedValue({ id: listId, name: "VIP" });
    mocks.updateContactListMembers.mockResolvedValue({ id: listId, count: 1 });
    const { run } = runtime();
    await run("manage_contact_lists", { action: "create", name: "VIP" });
    expect(mocks.createContactList).toHaveBeenCalledWith(tx, actor, {
      name: "VIP",
      color: "gray",
    });
    await run("manage_contact_lists", {
      action: "remove",
      listId,
      contactIds: [contactId],
    });
    expect(mocks.updateContactListMembers).toHaveBeenCalledWith(
      tx,
      actor,
      listId,
      { add: [], remove: [contactId] },
    );
    await expect(
      run("manage_contact_lists", { action: "add", listId }),
    ).rejects.toThrow();
  });
});
