/**
 * Outreach for the raise: a short, personal mail written from what the
 * workspace knows about the investor and the path to them, put in the
 * owner's own mailbox as a DRAFT through their Soko Bot's Gmail. Sokosumi
 * never sends it; the owner reads it in Gmail and sends it, and the mail
 * capture then logs the touch and the reply.
 */
import { generateText } from "ai";
import { z } from "zod";
import {
  notFound,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import prisma from "@/lib/db/prisma";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";
import type {
  FundraisingDraftInput,
  FundraisingIntroAskInput,
  FundraisingProspectDto,
} from "@/schemas/fundraising.schema";
import { SokoBotIntegrationError } from "@/services/composio-integration-tools.service";
import { CONTACT_ENRICHMENT_MODEL } from "@/services/contact-enrichment.service";
import {
  CONTACT_INCLUDE,
  contactDtos,
  inContactTransaction,
  updateContact,
} from "@/services/contacts.service";
import { dataRoomLink } from "@/services/data-room-email.service";
import {
  type FundraisingActor,
  listFundraisingPipeline,
  updateFundraisingProspect,
} from "@/services/fundraising.service";
import { ownerMailboxIntegration } from "@/services/fundraising-mailbox.service";
import {
  type ActiveIntegration,
  createInboxDraft,
} from "@/services/soko-bot-integrations.service";

const MODEL_TIMEOUT_MS = 30_000;
const FOLLOW_UP_DAYS = 7;

const COMPOSE_SYSTEM = `You write short, personal fundraising emails for a founder who is raising a round.
Plain text, no markdown, no "I hope this finds you well", no flattery, no buzzwords. Under 130 words. Write in the first person as the sender.
Every mail is about the raise in "raise": say in one line what the company does and what is being raised, from those facts only. Call the company by raise.company, its everyday name; the legal name and legal form stay out unless no everyday name is given. End with one clear ask that has a time frame, such as a 20 minute call this week or next.
kind "intro": a first mail to the investor; or, when "via" is given, a mail to that mutual contact asking for an introduction to the investor (address the contact, not the investor, and keep the part they can forward to three lines).
kind "follow_up": a follow-up after earlier contact: name the last touch concretely from lastTouches (when and what it was about), then move the raise one step; do not repeat the pitch.
When a data room link is given, mention it once as the place with the deck and numbers.
Subject: specific, with the company or the round in it; never just "Following up".
Use only the facts given; never invent numbers, names, deals or dates.
Answer with JSON only: {"subject": "...", "body": "..."}.`;

const INTRO_ASK_SYSTEM = `You write two short mails for a founder who is raising a round and wants a warm, double opt-in introduction to an investor through someone who knows them (the connector).
Plain text, no markdown, no "I hope this finds you well", no flattery, no buzzwords. Write in the first person as the sender. Use only the facts given; never invent numbers, names, deals or dates. Call the company by raise.company, its everyday name.
"ask": to the connector. Three to five lines. Greet them by first name, one line of context on how you know each other if lastTouches gives one, then the one ask: would they be open to introducing you to the investor (name and firm), only if they are comfortable and the investor says yes first. Say the forwardable note is below so they need not write anything. One investor per mail. Subject: "Intro to {investor} for {company}?".
"forwardable": written to the investor, for the connector to forward as is. Subject: "Intro to {investor first name} for {company}" style, naming investor and company. Under 120 words, readable in under a minute: one line on what the company does, one or two lines of proof (traction, team, round) from the facts, one line on why this investor in particular (their thesis, a deal, the portfolio), the ask for a 20 minute call. If a data room link is given, mention it once as the place with the deck and numbers; no attachments.
Answer with JSON only: {"ask": {"subject": "...", "body": "..."}, "forwardable": {"subject": "...", "body": "..."}}.`;

const draftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
});

const introAskSchema = z.object({ ask: draftSchema, forwardable: draftSchema });

/** The model's two mails, or null when its answer does not parse. */
export function parseIntroAsk(
  text: string,
): z.infer<typeof introAskSchema> | null {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return introAskSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The model's subject and body, or null when its answer does not parse. */
export function parseDraft(text: string): z.infer<typeof draftSchema> | null {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return draftSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

export interface OutreachDeps {
  compose: (input: {
    system: string;
    prompt: string;
  }) => Promise<{ text: string; costUsd: number }>;
  createDraft: (
    integration: ActiveIntegration,
    draft: { to: readonly string[]; subject: string; body: string },
  ) => Promise<string>;
}

async function composeWithModel(input: { system: string; prompt: string }) {
  const request = sokoBotModelRequest({
    role: "agent",
    model: CONTACT_ENRICHMENT_MODEL,
  });
  const result = await generateText({
    ...request,
    providerOptions: {
      ...request.providerOptions,
      google: { thinkingConfig: { thinkingLevel: "low" } },
    },
    system: input.system,
    prompt: input.prompt,
    maxOutputTokens: 4_000,
    abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  }).catch(rethrowAiGatewayFailure);
  return {
    text: result.text,
    costUsd: gatewayCostUsd(result.providerMetadata),
  };
}

const defaultDeps: OutreachDeps = {
  compose: composeWithModel,
  createDraft: createInboxDraft,
};

function primaryEmail(contact: {
  channels: { type: string; value: string; isPrimary: boolean }[];
}): string | null {
  const emails = contact.channels.filter((c) => c.type === "EMAIL");
  return (emails.find((c) => c.isPrimary) ?? emails[0])?.value ?? null;
}

/** Lets the investor into the room by their email and returns the room's link. */
async function letIntoRoom(
  actor: FundraisingActor,
  investor: {
    name: string;
    channels: Parameters<typeof primaryEmail>[0]["channels"];
  },
  roomId: string,
): Promise<string> {
  const room = await prisma.dataRoom.findFirst({
    where: { id: roomId, workspaceId: actor.workspaceId },
  });
  if (!room) throw notFound("Data room not found");
  const investorEmail = primaryEmail(investor);
  if (!investorEmail)
    throw unprocessableEntity(
      `${investor.name} has no email address, so they cannot be let into the data room`,
    );
  await prisma.dataRoomMember.upsert({
    where: { roomId_email: { roomId: room.id, email: investorEmail } },
    create: {
      roomId: room.id,
      email: investorEmail,
      name: investor.name,
      invitedByUserId: actor.userId,
    },
    update: { revokedAt: null, invitedByUserId: actor.userId },
  });
  return dataRoomLink(room);
}

/** What the mails may say about the company and the round, from the organization and the data room. */
async function raiseFacts(
  actor: FundraisingActor,
  roomRow: { id: string; title: string } | undefined,
  roomLink: string | null,
) {
  const [organization, room] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { name: true },
    }),
    roomRow
      ? prisma.dataRoom.findUnique({
          where: { id: roomRow.id },
          select: { welcomeNote: true, company: true },
        })
      : null,
  ]);
  const company = room?.company as { legalName?: string } | null;
  return {
    company: organization?.name ?? null,
    legalName: company?.legalName ?? null,
    round: roomRow ? roomRow.title : null,
    about: room?.welcomeNote?.slice(0, 800) ?? null,
    dataRoom: roomRow ? roomRow.title : null,
    roomLink,
  };
}

/**
 * Writes the draft and puts it in the owner's mailbox. The prospect remembers
 * the draft; the contact gets a next step and a follow-up date a week out.
 */
export async function draftOutreach(
  actor: FundraisingActor,
  contactId: string,
  input: FundraisingDraftInput,
  deps: OutreachDeps = defaultDeps,
): Promise<{
  to: string;
  subject: string;
  body: string;
  draftId: string;
  provider: string;
  roomLink: string | null;
  prospect: FundraisingProspectDto;
}> {
  const integration = await ownerMailboxIntegration(actor);
  if (!integration)
    throw unprocessableEntity(
      "Connect Gmail on your Soko Bot first; drafts go into your own mailbox",
    );
  const pipeline = await listFundraisingPipeline(actor);
  const prospect = pipeline.prospects.find((p) => p.contact.id === contactId);
  if (!prospect) throw notFound("This person is not on the Investors list");
  const investor = prospect.contact;

  const viaRow = input.viaContactId
    ? await prisma.contact.findFirst({
        where: {
          id: input.viaContactId,
          workspaceId: actor.workspaceId,
          archivedAt: null,
          mergedIntoId: null,
        },
        include: CONTACT_INCLUDE,
      })
    : null;
  if (input.viaContactId && !viaRow) throw notFound("Contact not found");
  const [via] = viaRow ? await contactDtos([viaRow], prisma, actor.userId) : [];
  const recipient = via ?? investor;
  const to = primaryEmail(recipient);
  if (!to)
    throw unprocessableEntity(
      `${recipient.name} has no email address yet; add one in Contacts`,
    );

  const roomLink = input.inviteToRoomId
    ? await letIntoRoom(actor, investor, input.inviteToRoomId)
    : null;

  const roomRow = pipeline.rooms[0];
  const [sender, interactions, raise] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, email: true },
    }),
    prisma.contactInteraction.findMany({
      where: { contactId },
      orderBy: { occurredAt: "desc" },
      take: 4,
      select: {
        occurredAt: true,
        channel: true,
        direction: true,
        summary: true,
      },
    }),
    raiseFacts(actor, roomRow, roomLink),
  ]);
  const composed = await deps.compose({
    system: COMPOSE_SYSTEM,
    prompt: JSON.stringify({
      kind: input.kind,
      sender: { name: sender?.name ?? "", email: sender?.email ?? "" },
      investor: {
        name: investor.name,
        firm: investor.organization,
        role: investor.role,
        thesis: prospect.thesis,
        whyInteresting: investor.whyInteresting,
        summary: investor.summary,
        lastTouches: interactions.map((i) => ({
          when: i.occurredAt.toISOString().slice(0, 10),
          channel: i.channel,
          direction: i.direction,
          summary: i.summary,
        })),
      },
      via: via
        ? {
            name: via.name,
            role: via.role,
            organization: via.organization,
          }
        : null,
      raise,
      note: input.note ?? null,
    }),
  });
  const draft = parseDraft(composed.text);
  if (!draft)
    throw serviceUnavailable("The draft did not come out readable; try again");

  const draftId = await deps
    .createDraft(integration, {
      to: [to],
      subject: draft.subject,
      body: draft.body,
    })
    .catch((error: unknown) => {
      if (error instanceof SokoBotIntegrationError)
        throw serviceUnavailable(
          `The mailbox refused the draft: ${error.message}`,
        );
      throw error;
    });

  const followUpAt = new Date(Date.now() + FOLLOW_UP_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);
  await inContactTransaction(async (tx) => {
    await tx.fundraisingProspect.upsert({
      where: { contactId },
      create: {
        workspaceId: actor.workspaceId,
        contactId,
        lastDraftAt: new Date(),
        lastDraftSubject: draft.subject,
      },
      update: { lastDraftAt: new Date(), lastDraftSubject: draft.subject },
    });
    const current = await tx.contact.findUniqueOrThrow({
      where: { id: contactId },
      select: { version: true },
    });
    await updateContact(tx, actor, contactId, {
      version: current.version,
      nextStep: via
        ? `Send the intro request to ${via.name} from Gmail drafts; nudge if quiet by ${followUpAt}`
        : `Send the draft to ${investor.name} from Gmail drafts; follow up if quiet by ${followUpAt}`,
      followUpAt,
    });
  });
  const updated = (await listFundraisingPipeline(actor)).prospects.find(
    (p) => p.contact.id === contactId,
  );
  return {
    to,
    subject: draft.subject,
    body: draft.body,
    draftId,
    provider: integration.provider.name,
    roomLink,
    prospect: updated ?? prospect,
  };
}

const FORWARDABLE_DIVIDER = "----- Forwardable note, written to them -----";

/**
 * The double opt-in ask: two drafts in the owner's mailbox, never sent. The
 * ask goes to the connector with the forwardable note below a line, so one
 * mail is all they need; the note alone is a second draft, addressed to the
 * investor when their address is known, for when the connector says "go
 * ahead" or the owner wants to send it on a thread. The investor's intro is
 * marked as asked, which sets the next step and the nudge date.
 */
export async function draftIntroAsk(
  actor: FundraisingActor,
  contactId: string,
  input: FundraisingIntroAskInput,
  deps: OutreachDeps = defaultDeps,
): Promise<{
  ask: { to: string; subject: string; body: string; draftId: string };
  forwardable: { to: string; subject: string; body: string; draftId: string };
  provider: string;
  roomLink: string | null;
  prospect: FundraisingProspectDto;
}> {
  const integration = await ownerMailboxIntegration(actor);
  if (!integration)
    throw unprocessableEntity(
      "Connect Gmail on your Soko Bot first; drafts go into your own mailbox",
    );
  if (!input.viaContactId && !input.viaUserId)
    throw unprocessableEntity("Say who is asked for the introduction");
  const pipeline = await listFundraisingPipeline(actor);
  const prospect = pipeline.prospects.find((p) => p.contact.id === contactId);
  if (!prospect) throw notFound("This person is not on the Investors list");
  const investor = prospect.contact;

  const connector = await (async () => {
    if (input.viaContactId) {
      const row = await prisma.contact.findFirst({
        where: {
          id: input.viaContactId,
          workspaceId: actor.workspaceId,
          archivedAt: null,
          mergedIntoId: null,
        },
        include: CONTACT_INCLUDE,
      });
      if (!row) throw notFound("Contact not found");
      const [dto] = await contactDtos([row], prisma, actor.userId);
      if (!dto) throw notFound("Contact not found");
      const interactions = await prisma.contactInteraction.findMany({
        where: { contactId: dto.id },
        orderBy: { occurredAt: "desc" },
        take: 3,
        select: { occurredAt: true, channel: true, summary: true },
      });
      return {
        name: dto.name,
        email: primaryEmail(dto),
        role: dto.role,
        organization: dto.organization,
        lastTouches: interactions.map((i) => ({
          when: i.occurredAt.toISOString().slice(0, 10),
          channel: i.channel,
          summary: i.summary,
        })),
      };
    }
    const member = await prisma.member.findFirst({
      where: {
        userId: input.viaUserId ?? "",
        organizationId: actor.organizationId,
      },
      select: { user: { select: { name: true, email: true } } },
    });
    if (!member)
      throw unprocessableEntity(
        "The connector must be a member of the organization",
      );
    return {
      name: member.user.name,
      email: member.user.email,
      role: "teammate",
      organization: null,
      lastTouches: [],
    };
  })();
  if (!connector.email)
    throw unprocessableEntity(
      `${connector.name} has no email address yet; add one in Contacts`,
    );

  const roomLink = input.inviteToRoomId
    ? await letIntoRoom(actor, investor, input.inviteToRoomId)
    : null;
  const [sender, raise, portfolio] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, email: true },
    }),
    raiseFacts(actor, pipeline.rooms[0], roomLink),
    prisma.fundraisingPortfolioCompany.findMany({
      where: { contactId },
      orderBy: [{ date: "desc" }],
      take: 6,
      select: { name: true, round: true, date: true },
    }),
  ]);
  const composed = await deps.compose({
    system: INTRO_ASK_SYSTEM,
    prompt: JSON.stringify({
      sender: { name: sender?.name ?? "", email: sender?.email ?? "" },
      connector,
      investor: {
        name: investor.name,
        firm: investor.organization,
        role: investor.role,
        thesis: prospect.thesis,
        whyInteresting: investor.whyInteresting,
        summary: investor.summary,
        portfolio,
        howConnectorKnowsThem: prospect.bestPath
          ? {
              kind: prospect.bestPath.kind,
              through: prospect.bestPath.through?.name ?? null,
              company: prospect.bestPath.company?.name ?? null,
            }
          : null,
      },
      raise,
      note: input.note ?? null,
    }),
  });
  const mails = parseIntroAsk(composed.text);
  if (!mails)
    throw serviceUnavailable("The drafts did not come out readable; try again");

  const putDraft = (mail: { to: string; subject: string; body: string }) =>
    deps
      .createDraft(integration, {
        to: [mail.to],
        subject: mail.subject,
        body: mail.body,
      })
      .catch((error: unknown) => {
        if (error instanceof SokoBotIntegrationError)
          throw serviceUnavailable(
            `The mailbox refused the draft: ${error.message}`,
          );
        throw error;
      });
  const ask = {
    to: connector.email,
    subject: mails.ask.subject,
    body: `${mails.ask.body.trim()}\n\n${FORWARDABLE_DIVIDER}\n\n${mails.forwardable.body.trim()}`,
  };
  const forwardable = {
    to: primaryEmail(investor) ?? connector.email,
    subject: mails.forwardable.subject,
    body: mails.forwardable.body,
  };
  const askId = await putDraft(ask);
  const forwardableId = await putDraft(forwardable);

  await prisma.fundraisingProspect.upsert({
    where: { contactId },
    create: {
      workspaceId: actor.workspaceId,
      contactId,
      lastDraftAt: new Date(),
      lastDraftSubject: ask.subject,
    },
    update: { lastDraftAt: new Date(), lastDraftSubject: ask.subject },
  });
  const updated = await updateFundraisingProspect(actor, contactId, {
    intro: {
      state: "ASKED",
      ...(input.viaContactId ? { viaContactId: input.viaContactId } : {}),
      ...(input.viaUserId ? { viaUserId: input.viaUserId } : {}),
    },
  });
  return {
    ask: { ...ask, draftId: askId },
    forwardable: { ...forwardable, draftId: forwardableId },
    provider: integration.provider.name,
    roomLink,
    prospect: updated,
  };
}
