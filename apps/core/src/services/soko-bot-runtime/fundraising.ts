/**
 * The raise, for the owner's own bot: where each investor stands, how to
 * reach one, and finding new ones. Owner only, and only in a workspace whose
 * organization has Fundraising; anything else is refused in words the bot
 * can repeat. Nothing here sends mail.
 */
import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { contactDetailHref } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import prisma from "@/lib/db/prisma";
import {
  type FundraisingActor,
  fundraisingEnabled,
  listFundraisingPipeline,
} from "@/services/fundraising.service";
import {
  researchPortfolio,
  warmPaths,
} from "@/services/fundraising-paths.service";
import { findInvestors } from "@/services/fundraising-research.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import {
  actingMemberOf,
  actsForOwner,
  requireSokoBotWorkspaceAccess,
} from "./acting-scope";
import type { RuntimeOperations } from "./operations";

export const FUNDRAISING_CAPABILITIES = [
  "fundraising_pipeline",
  "investor_warm_paths",
  "find_investors",
] as const;

export function isFundraisingCapability(
  capability: string,
): capability is (typeof FUNDRAISING_CAPABILITIES)[number] {
  return (FUNDRAISING_CAPABILITIES as readonly string[]).includes(capability);
}

const WEEK_MS = 7 * 864e5;

/** A DTO date, still a Date or an ISO string before the schema runs. */
function toMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value) return Date.parse(value);
  return null;
}

async function fundraisingActor(
  authorized: AuthorizedSokoBotRuntime,
): Promise<FundraisingActor> {
  if (!actsForOwner(authorized))
    throw new SokoBotRefusedUnsentError(
      "The raise is the owner's: only the owner can ask about it.",
    );
  const userId = actingMemberOf(authorized);
  const { workspaceId } = authorized.turn;
  await requireSokoBotWorkspaceAccess(prisma, userId, workspaceId);
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { organizationId: true },
  });
  const organizationId = workspace?.organizationId ?? null;
  if (!organizationId || !fundraisingEnabled(organizationId))
    throw new SokoBotRefusedUnsentError(
      "Fundraising is not on for this workspace, so there is no raise to read. Say so; do not guess at investors.",
    );
  return {
    workspaceId,
    userId,
    sokoBotId: authorized.turn.sokoBotId,
    organizationId,
  };
}

export async function executeFundraisingTool(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
) {
  const { capability } = input;
  if (!isFundraisingCapability(capability))
    throw new SokoBotRuntimeValidationError("Not a fundraising tool");
  const actor = await fundraisingActor(authorized);
  try {
    if (capability === "fundraising_pipeline") {
      const filter = SOKO_BOT_TOOL_INPUT_SCHEMAS.fundraising_pipeline.parse(
        input.input,
      );
      const pipeline = await listFundraisingPipeline(actor);
      const today = new Date().toISOString().slice(0, 10);
      const now = Date.now();
      const rows = pipeline.prospects
        .filter((p) => !filter.stage || p.stage === filter.stage)
        .filter(
          (p) =>
            !filter.openedDataRoom ||
            (p.dataRoom !== null && p.dataRoom.firstVisitAt !== null),
        )
        .filter(
          (p) =>
            !filter.introPending ||
            (p.intro.via !== null &&
              p.intro.askedAt !== null &&
              p.intro.madeAt === null &&
              p.intro.declinedAt === null),
        )
        .filter((p) => {
          if (!filter.needsFollowUp) return true;
          const followUpAt = p.contact.followUpAt;
          const due = typeof followUpAt === "string" && followUpAt <= today;
          const sinceMs = toMs(p.contact.awaitingReplySince);
          const quiet = sinceMs !== null && now - sinceMs >= WEEK_MS;
          return due || quiet;
        })
        .slice(0, filter.limit);
      return {
        list: pipeline.list,
        dataRooms: pipeline.rooms.map((room) => room.title),
        total: pipeline.prospects.length,
        shown: rows.length,
        investors: rows.map((p) => ({
          contactId: p.contact.id,
          name: p.contact.name,
          fund: p.contact.organization,
          role: p.contact.role,
          email:
            p.contact.channels.find((c) => c.type === "EMAIL")?.value ?? null,
          stage: p.stage,
          owner: p.owner?.name ?? null,
          nextStep: p.contact.nextStep,
          followUpAt: p.contact.followUpAt,
          lastContactAt: p.contact.lastContactAt,
          replyState: p.contact.replyState,
          ticketSize: p.ticketSize,
          committedUsd: p.committedUsd,
          thesis: p.thesis,
          lastDraft: p.lastDraftAt
            ? { at: p.lastDraftAt, subject: p.lastDraftSubject }
            : null,
          intro: p.intro.via
            ? {
                via: p.intro.via.name,
                askedAt: p.intro.askedAt,
                madeAt: p.intro.madeAt,
                declinedAt: p.intro.declinedAt,
              }
            : null,
          bestPath: p.bestPath
            ? {
                kind: p.bestPath.kind,
                via: p.bestPath.via?.name ?? null,
                through: p.bestPath.through?.name ?? null,
                company: p.bestPath.company?.name ?? null,
                strength: p.bestPath.strength,
              }
            : null,
          dataRoom: p.dataRoom
            ? {
                room: p.dataRoom.roomTitle,
                firstVisitAt: p.dataRoom.firstVisitAt,
                lastVisitAt: p.dataRoom.lastVisitAt,
                views: p.dataRoom.views,
                downloads: p.dataRoom.downloads,
                lastOpened: p.dataRoom.lastOpened,
                accessRemoved: p.dataRoom.revoked,
              }
            : null,
          link: contactDetailHref(p.contact.id, actor.workspaceId),
        })),
        page: "/fundraising",
      };
    }
    if (capability === "investor_warm_paths") {
      const { contactId, research } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.investor_warm_paths.parse(input.input);
      const result = research
        ? await researchPortfolio(actor, contactId)
        : await warmPaths(actor, contactId);
      const answer = {
        contactId,
        paths: result.paths.map((path) => ({
          kind: path.kind,
          teammate: path.via?.name ?? null,
          connectedOnLinkedIn: path.linkedIn,
          through: path.through
            ? {
                name: path.through.name,
                role: path.through.role,
                organization: path.through.organization,
                email: path.through.email,
                link: contactDetailHref(path.through.id, actor.workspaceId),
              }
            : null,
          company: path.company,
          strength: path.strength,
          touches: path.touches,
          lastTouchAt: path.lastTouchAt,
        })),
        portfolio: result.portfolio.map((company) => ({
          name: company.name,
          round: company.round,
          date: company.date,
          source: company.sourceUrl,
        })),
        researchedAt: result.researchedAt,
        ...(research
          ? {
              researchCostUsd: result.researchUsd,
              monthUsd: result.research.monthUsd,
            }
          : {}),
      };
      return research
        ? runtime.commitReceipt(authorized, input.toolCallId, contactId, answer)
        : answer;
    }
    const search = SOKO_BOT_TOOL_INPUT_SCHEMAS.find_investors.parse(
      input.input,
    );
    const result = await findInvestors(actor, search);
    return runtime.commitReceipt(
      authorized,
      input.toolCallId,
      actor.workspaceId,
      {
        found: result.found,
        costUsd: result.costUsd,
        monthUsd: result.research.monthUsd,
        capUsd: result.research.capUsd,
        suggestionsLink: "/fundraising",
      },
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status < 500)
      throw new SokoBotRefusedUnsentError(error.message);
    throw error;
  }
}
