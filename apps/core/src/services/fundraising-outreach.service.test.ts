import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  contact: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
  dataRoom: { findFirst: vi.fn() },
  dataRoomMember: { upsert: vi.fn() },
  user: { findUnique: vi.fn() },
  contactInteraction: { findMany: vi.fn() },
  fundraisingProspect: { upsert: vi.fn() },
}));
const mocks = vi.hoisted(() => ({
  ownerMailboxIntegration: vi.fn(),
  listFundraisingPipeline: vi.fn(),
  updateContact: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));
vi.mock("@/services/fundraising-mailbox.service", () => ({
  ownerMailboxIntegration: mocks.ownerMailboxIntegration,
}));
vi.mock("@/services/fundraising.service", () => ({
  listFundraisingPipeline: mocks.listFundraisingPipeline,
}));
vi.mock("@/services/contacts.service", () => ({
  CONTACT_INCLUDE: {},
  contactDtos: vi.fn(async (rows: { id: string }[]) => rows),
  inContactTransaction: vi.fn(async (run: (tx: unknown) => unknown) =>
    run(prismaMock),
  ),
  updateContact: mocks.updateContact,
}));
vi.mock("@/services/data-room-email.service", () => ({
  dataRoomLink: (room: { token: string }) =>
    `https://app.example.com/share/rooms/${room.token}`,
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  createInboxDraft: vi.fn(),
}));
vi.mock("@/services/composio-integration-tools.service", () => ({
  SokoBotIntegrationError: class extends Error {},
}));
vi.mock("@/services/contact-enrichment.service", () => ({
  CONTACT_ENRICHMENT_MODEL: "test-model",
}));

import { draftOutreach, parseDraft } from "./fundraising-outreach.service";

const actor = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: "alice",
  sokoBotId: null,
  organizationId: "org",
};
const CONTACT = "22222222-2222-7222-8222-222222222222";
const ROOM = "33333333-3333-7333-8333-333333333333";
const integration = {
  id: "int-1",
  sokoBotId: "bot-1",
  provider: {
    id: "gmail",
    name: "Gmail",
    tools: { createDraft: "GMAIL_CREATE_EMAIL_DRAFT" },
  },
  composioAccountId: "acc",
  connectorUserId: null,
  cursor: null,
};
const investor = {
  id: CONTACT,
  name: "Ann Partner",
  organization: "Ann Capital",
  role: "Partner",
  whyInteresting: "Backs agent payments",
  summary: null,
  version: 3,
  channels: [{ type: "EMAIL", value: "ann@anncapital.com", isPrimary: true }],
};
const prospect = {
  contact: investor,
  stage: "WARM_PATH",
  thesis: "Pre-seed and seed in agent infrastructure",
  lastDraftAt: null,
  lastDraftSubject: null,
};

describe("parseDraft", () => {
  it("reads the subject and body out of the model's answer", () => {
    expect(
      parseDraft('Here: {"subject": "Quick intro", "body": "Hi Ann,\\n…"}'),
    ).toEqual({ subject: "Quick intro", body: "Hi Ann,\n…" });
    expect(parseDraft("no json")).toBeNull();
    expect(parseDraft('{"subject": ""}')).toBeNull();
  });
});

describe("draftOutreach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ownerMailboxIntegration.mockResolvedValue(integration);
    mocks.listFundraisingPipeline.mockResolvedValue({
      prospects: [prospect],
      rooms: [{ id: ROOM, title: "Seed Round 2026", token: "tok" }],
    });
    prismaMock.user.findUnique.mockResolvedValue({
      name: "Patrick",
      email: "patrick@example.com",
    });
    prismaMock.contactInteraction.findMany.mockResolvedValue([
      {
        occurredAt: new Date("2026-11-01T10:00:00Z"),
        channel: "MEETING",
        direction: "BOTH",
        summary: "Met at the dinner",
      },
    ]);
    prismaMock.dataRoom.findFirst.mockResolvedValue({ id: ROOM, token: "tok" });
    prismaMock.dataRoomMember.upsert.mockResolvedValue({});
    prismaMock.fundraisingProspect.upsert.mockResolvedValue({});
    prismaMock.contact.findUniqueOrThrow.mockResolvedValue({ version: 3 });
  });

  it("writes to the investor, lets them into the room, drafts in the mailbox and sets the follow-up", async () => {
    const compose = vi.fn().mockResolvedValue({
      text: '{"subject": "Masumi seed round", "body": "Hi Ann, …"}',
      costUsd: 0.001,
    });
    const createDraft = vi.fn().mockResolvedValue("draft-9");
    const result = await draftOutreach(
      actor,
      CONTACT,
      { kind: "intro", inviteToRoomId: ROOM },
      { compose, createDraft },
    );
    expect(result).toMatchObject({
      to: "ann@anncapital.com",
      subject: "Masumi seed round",
      draftId: "draft-9",
      provider: "Gmail",
      roomLink: "https://app.example.com/share/rooms/tok",
    });
    const prompt = JSON.parse(compose.mock.calls[0]?.[0].prompt);
    expect(prompt).toMatchObject({
      kind: "intro",
      investor: { name: "Ann Partner", firm: "Ann Capital" },
      raise: { roomLink: "https://app.example.com/share/rooms/tok" },
    });
    expect(prompt.investor.lastTouches[0]).toMatchObject({
      when: "2026-11-01",
    });
    expect(prismaMock.dataRoomMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId_email: { roomId: ROOM, email: "ann@anncapital.com" } },
      }),
    );
    expect(createDraft).toHaveBeenCalledWith(integration, {
      to: ["ann@anncapital.com"],
      subject: "Masumi seed round",
      body: "Hi Ann, …",
    });
    expect(prismaMock.fundraisingProspect.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          lastDraftSubject: "Masumi seed round",
        }),
      }),
    );
    expect(mocks.updateContact.mock.calls[0]?.[3]).toMatchObject({
      version: 3,
      followUpAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("asks the mutual contact for an intro when a path is given", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({
      id: "44444444-4444-7444-8444-444444444444",
      name: "Fay Founder",
      role: "CEO",
      organization: "AgentPay",
      channels: [{ type: "EMAIL", value: "fay@agentpay.io", isPrimary: false }],
    });
    const compose = vi.fn().mockResolvedValue({
      text: '{"subject": "Intro to Ann?", "body": "Hi Fay, …"}',
      costUsd: 0,
    });
    const createDraft = vi.fn().mockResolvedValue("draft-10");
    const result = await draftOutreach(
      actor,
      CONTACT,
      { kind: "intro", viaContactId: "44444444-4444-7444-8444-444444444444" },
      { compose, createDraft },
    );
    expect(result.to).toBe("fay@agentpay.io");
    expect(JSON.parse(compose.mock.calls[0]?.[0].prompt).via).toMatchObject({
      name: "Fay Founder",
    });
    expect(mocks.updateContact.mock.calls[0]?.[3].nextStep).toContain(
      "Fay Founder",
    );
  });

  it("refuses without a mailbox or an address, before writing anything", async () => {
    mocks.ownerMailboxIntegration.mockResolvedValue(null);
    await expect(
      draftOutreach(
        actor,
        CONTACT,
        { kind: "intro" },
        { compose: vi.fn(), createDraft: vi.fn() },
      ),
    ).rejects.toMatchObject({ status: 422 });
    mocks.ownerMailboxIntegration.mockResolvedValue(integration);
    mocks.listFundraisingPipeline.mockResolvedValue({
      prospects: [{ ...prospect, contact: { ...investor, channels: [] } }],
      rooms: [],
    });
    const createDraft = vi.fn();
    await expect(
      draftOutreach(
        actor,
        CONTACT,
        { kind: "follow_up" },
        { compose: vi.fn(), createDraft },
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(createDraft).not.toHaveBeenCalled();
  });
});
