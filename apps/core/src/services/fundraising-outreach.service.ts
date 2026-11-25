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
Every mail is about the raise in "raise": say in one line what the company does and what is being raised, from those facts only. End with one clear ask that has a time frame, such as a 20 minute call this week or next.
kind "intro": a first mail to the investor; or, when "via" is given, a mail to that mutual contact asking for an introduction to the investor (address the contact, not the investor, and keep the part they can forward to three lines).
kind "follow_up": a follow-up after earlier contact: name the last touch concretely from lastTouches (when and what it was about), then move the raise one step; do not repeat the pitch.
When a data room link is given, mention it once as the place with the deck and numbers.
Subject: specific, with the company or the round in it; never just "Following up".
Use only the facts given; never invent numbers, names, deals or dates.
Answer with JSON only: {"subject": "...", "body": "..."}.`;

const draftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
});

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

  let roomLink: string | null = null;
  if (input.inviteToRoomId) {
    const room = await prisma.dataRoom.findFirst({
      where: { id: input.inviteToRoomId, workspaceId: actor.workspaceId },
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
    roomLink = dataRoomLink(room);
  }

  const roomRow = pipeline.rooms[0];
  const [sender, interactions, organization, room] = await Promise.all([
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
      raise: {
        company: organization?.name ?? null,
        legalName: company?.legalName ?? null,
        round: roomRow ? roomRow.title : null,
        about: room?.welcomeNote?.slice(0, 800) ?? null,
        dataRoom: roomRow ? roomRow.title : null,
        roomLink,
      },
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
