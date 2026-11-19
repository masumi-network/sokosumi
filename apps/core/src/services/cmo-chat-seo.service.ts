import { z } from "zod";

import { plainExcerpt } from "@/helpers/job-digest";
import prisma from "@/lib/db/prisma";
import type { Cuso } from "@/services/cmo-cuso.service";
import {
  type CmoSeoAuditRun,
  listCmoSeoAuditRuns,
} from "@/services/cmo-seo-audit.service";
import { readSeoCheck } from "@/services/cmo-seo-rankings.service";

/**
 * The SEO specialist's work as the chat shows it: a position check Cuso
 * asked for, and each weekly audit of the site. `cmo-chat-work.service.ts`
 * adds what Cuso makes and hands to a Coworker or a hired Agent.
 */
export interface CmoChatSeoWork {
  /** The tool call that asked for a check; a weekly audit's own id. */
  id: string;
  kind: "seo" | "audit";
  state: "making" | "ready" | "failed";
  at: Date;
  title: string;
  by: string;
  /** What it found, or why it could not finish. */
  text: string | null;
  readable: boolean;
}

type Target = Pick<Cuso, "sokoBotId" | "projectId">;

const SEO_CHECK = "check_search_rankings";
/** Who checks the site, as the owner knows them. */
const SEO_SPECIALIST = "The SEO specialist";
/** Older work has scrolled far out of the chat's 50 messages. */
const SHOWN_DAYS = 30;
const SHOWN_CHECKS = 10;
/** A check takes minutes; one still running after this never comes back. */
const GIVE_UP_MS = 60 * 60 * 1000;
/** How much of a result the card itself shows. */
const EXCERPT = 280;

const checkSchema = z.object({ analysisId: z.string().uuid() });
const searchesSchema = z.object({ keywords: z.array(z.string()).min(1) });

const CALL_SELECT = {
  id: true,
  createdAt: true,
  input: true,
  result: true,
} as const;

interface CheckCall {
  id: string;
  createdAt: Date;
  input: unknown;
  result: unknown;
}

/** The check a `check_search_rankings` call started or joined. */
function checkId(call: CheckCall): string | null {
  return checkSchema.safeParse(call.result).data?.analysisId ?? null;
}

/** What the SEO specialist was asked: the searches, as the owner reads them. */
function checkTitle(call: CheckCall): string {
  const searches = searchesSchema.safeParse(call.input).data?.keywords ?? [];
  return searches.length > 0
    ? `Where you rank on Google for ${searches.map((search) => `"${search}"`).join(", ")}`
    : "Where you rank on Google";
}

function auditWork(audit: CmoSeoAuditRun): CmoChatSeoWork {
  const found = audit.found;
  return {
    id: `audit-${audit.id}`,
    kind: "audit",
    state:
      audit.state === "done"
        ? "ready"
        : audit.state === "failed"
          ? "failed"
          : "making",
    at: audit.startedAt,
    title: "Weekly audit of your site",
    by: SEO_SPECIALIST,
    text:
      audit.state === "failed"
        ? "The audit did not finish, so nothing was charged. The next one runs on schedule."
        : found
          ? `${found.passed} of ${found.checked} checks passed. ${
              found.fixes === 0
                ? "Nothing to fix this week."
                : found.fixes === 1
                  ? "1 thing to fix is in your SEO tab."
                  : `${found.fixes} things to fix are in your SEO tab.`
            }`
          : null,
    readable: false,
  };
}

/**
 * The position checks Cuso asked of the SEO specialist and the weekly audits
 * Core asks for on the owner's plan, each with where it stands now. The same
 * searches asked again while a check runs show once, where they were first
 * asked; an answer given at once from the last day's check started nothing
 * and shows no card.
 */
export async function listCmoChatSeoWork(
  cuso: Target,
  now: Date = new Date(),
): Promise<CmoChatSeoWork[]> {
  const since = new Date(now.getTime() - SHOWN_DAYS * 24 * 60 * 60 * 1000);
  const [calls, audits] = await Promise.all([
    prisma.sokoBotToolCall.findMany({
      where: {
        status: "COMPLETED",
        capability: SEO_CHECK,
        turn: { sokoBotId: cuso.sokoBotId, createdAt: { gte: since } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: SHOWN_CHECKS,
      select: CALL_SELECT,
    }) as Promise<CheckCall[]>,
    listCmoSeoAuditRuns(cuso.projectId, since, now),
  ]);
  const first = new Map<string, CheckCall>();
  for (const call of calls) {
    const id = checkId(call);
    if (id && !first.has(id)) first.set(id, call);
  }
  const checks = await Promise.all(
    [...first].map(async ([analysisId, call]): Promise<CmoChatSeoWork> => {
      const check = await readSeoCheck(analysisId);
      return {
        id: call.id,
        kind: "seo",
        state:
          check.state === "done"
            ? "ready"
            : check.state === "failed" ||
                now.getTime() - call.createdAt.getTime() > GIVE_UP_MS
              ? "failed"
              : "making",
        at: call.createdAt,
        title: checkTitle(call),
        by: SEO_SPECIALIST,
        text:
          check.state === "running"
            ? null
            : plainExcerpt(check.outcome, EXCERPT),
        readable: check.state === "done",
      };
    }),
  );
  return [...checks, ...audits.map(auditWork)];
}

/** A finished position check's whole result; null for anything else. */
export async function readCmoChatSeoText(
  cuso: Target,
  id: string,
): Promise<string | null> {
  const call: CheckCall | null = await prisma.sokoBotToolCall.findFirst({
    where: {
      id,
      status: "COMPLETED",
      capability: SEO_CHECK,
      turn: { sokoBotId: cuso.sokoBotId },
    },
    select: CALL_SELECT,
  });
  const analysisId = call ? checkId(call) : null;
  const check = analysisId ? await readSeoCheck(analysisId) : null;
  return check?.state === "done" ? check.outcome : null;
}
