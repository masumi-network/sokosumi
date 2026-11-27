/**
 * The raise in the owner's morning stand-up: connectors who have not answered
 * an intro ask, investors quiet past their date, and data room opens since
 * yesterday. Read from the same pipeline the page shows; nothing is written.
 */
import prisma from "@/lib/db/prisma";
import type { FundraisingPipelineDto } from "@/schemas/fundraising.schema";
import {
  fundraisingEnabled,
  INTRO_ASK_NUDGE_DAYS,
  listFundraisingPipeline,
} from "@/services/fundraising.service";

const DAY_MS = 864e5;
const LINES = 8;

function toMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value) return Date.parse(value);
  return null;
}

function days(ms: number | null, now: Date): number | null {
  return ms === null ? null : Math.floor((now.getTime() - ms) / DAY_MS);
}

/** The lines for "## Your raise", or none when nothing needs the owner today. */
export function raiseBriefLines(
  pipeline: FundraisingPipelineDto,
  now: Date,
): string[] {
  const today = now.toISOString().slice(0, 10);
  const items: { weight: number; line: string }[] = [];
  for (const p of pipeline.prospects) {
    const name = p.contact.name;
    const fund = p.contact.organization ? ` (${p.contact.organization})` : "";
    const { intro } = p;
    if (intro.via && intro.askedAt && !intro.madeAt && !intro.declinedAt) {
      const since = days(toMs(intro.askedAt), now) ?? 0;
      if (since >= INTRO_ASK_NUDGE_DAYS)
        items.push({
          weight: 3,
          line: `- ${intro.via.name} has not answered your intro ask for ${name}${fund} in ${since} days: nudge them once, or ask someone else.`,
        });
      continue;
    }
    if (
      intro.via &&
      intro.madeAt &&
      !intro.declinedAt &&
      p.stage === "REACHED_OUT"
    ) {
      const since = days(toMs(intro.madeAt), now) ?? 0;
      const lastTouch = toMs(p.contact.lastContactAt);
      const quiet =
        lastTouch === null || lastTouch <= (toMs(intro.madeAt) ?? 0);
      if (quiet && since >= 7)
        items.push({
          weight: 2,
          line: `- ${name}${fund} has not replied since ${intro.via.name} made the intro ${since} days ago: one follow-up on the thread, then treat it as a pass.`,
        });
    }
    const opened = toMs(p.dataRoom?.lastVisitAt ?? null);
    if (opened !== null && now.getTime() - opened < DAY_MS)
      items.push({
        weight: 2,
        line: `- ${name}${fund} opened the data room ${p.dataRoom?.lastOpened ? `(${p.dataRoom.lastOpened}) ` : ""}in the last day: a good moment to write.`,
      });
    if (
      typeof p.contact.followUpAt === "string" &&
      p.contact.followUpAt <= today &&
      !(intro.via && intro.askedAt && !intro.madeAt && !intro.declinedAt)
    )
      items.push({
        weight: 1,
        line: `- ${name}${fund}: follow-up due${p.contact.followUpAt < today ? ` since ${p.contact.followUpAt}` : " today"}${p.contact.nextStep ? `: ${p.contact.nextStep}` : ""}.`,
      });
  }
  if (items.length === 0) return [];
  items.sort((a, b) => b.weight - a.weight);
  return [
    "## Your raise",
    ...items.slice(0, LINES).map((item) => item.line),
    "Drafts only, never a send: write them with draft_email or point your owner to Fundraising. Do not contact anyone yourself.",
    "",
  ];
}

/** The block for a personal bot whose workspace has Fundraising; empty otherwise. */
export async function raiseBlock(
  bot: { id: string; userId: string | null; workspaceId: string },
  now: Date,
): Promise<string[]> {
  if (!bot.userId) return [];
  const workspace = await prisma.workspace.findUnique({
    where: { id: bot.workspaceId },
    select: { organizationId: true },
  });
  const organizationId = workspace?.organizationId ?? null;
  if (!organizationId || !fundraisingEnabled(organizationId)) return [];
  const pipeline = await listFundraisingPipeline({
    workspaceId: bot.workspaceId,
    userId: bot.userId,
    sokoBotId: bot.id,
    organizationId,
  });
  return raiseBriefLines(pipeline, now);
}
