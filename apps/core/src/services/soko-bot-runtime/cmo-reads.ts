import {
  cmoReadsOnDemand,
  getSokoBotVersion,
  type MarketingStrategyPlan,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { parseBrandBrain } from "@/services/brand-brain.service";
import { findCusoForBot } from "@/services/cmo-cuso.service";
import { listCmoReports } from "@/services/cmo-reports.service";
import {
  cmoTurnExecutesPlan,
  cmoWorkingStrategy,
} from "@/services/cmo-strategy.service";
import { recentCompetitorMoves } from "@/services/competitor-feed.service";
import { readMarketingPlan } from "@/services/marketing-strategy.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

/** What one read hands back at most; the rest is counted, never cut silently. */
export const CMO_READ_CAP_BYTES = 24 * 1_024;
/** Days a calendar read may span. */
const MAX_CALENDAR_DAYS = 31;
const DAY_MS = 86_400_000;
const REPORTS_LISTED = 30;

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "");
}

/** Items while they fit the cap, with how many more matched. */
export function capped<T>(
  items: readonly T[],
  cap: number = CMO_READ_CAP_BYTES,
): { items: T[]; more: number } {
  const kept: T[] = [];
  let size = 2;
  for (const item of items) {
    const next = bytes(item) + 1;
    if (size + next > cap) break;
    kept.push(item);
    size += next;
  }
  return { items: kept, more: items.length - kept.length };
}

function cutText(value: unknown, cap: number = CMO_READ_CAP_BYTES): unknown {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) <= cap) return value;
  return {
    cut: true,
    note: "Longer than one read: this is its start as text.",
    text: Buffer.from(text).subarray(0, cap).toString("utf8"),
  };
}

/**
 * The Cuso a read is for: only his own Project, only on a version that reads
 * on demand, and never on a teammate's question (a teammate never sees the
 * plan, ADR 0061).
 */
async function cusoForRead(authorized: AuthorizedSokoBotRuntime) {
  const version = getSokoBotVersion(authorized.turn.versionId);
  if (version.profile !== "cmo" || !cmoReadsOnDemand(version.skills))
    throw new SokoBotRuntimeAuthorizationError(
      "Only a CMO assistant on an organized context reads these",
    );
  if (authorized.askedByKind === "TEAMMATE")
    throw new SokoBotRuntimeAuthorizationError(
      "A teammate's question does not read the marketing plan",
    );
  const cuso = await findCusoForBot(authorized.turn.sokoBotId);
  if (!cuso)
    throw new SokoBotRuntimeValidationError(
      "This bot has no marketing Project.",
    );
  return cuso;
}

/** The strategy version this turn works on: the approved one while it executes. */
async function workingPlan(
  authorized: AuthorizedSokoBotRuntime,
  projectId: string,
): Promise<{
  plan: MarketingStrategyPlan | null;
  approved: boolean;
}> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select: { source: true, clientTurnId: true },
  });
  const version = await cmoWorkingStrategy(
    projectId,
    turn ? cmoTurnExecutesPlan(turn) : false,
  );
  return {
    plan: await readMarketingPlan(version),
    approved: version?.approvedAt != null,
  };
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function same(left: string | undefined, right: string): boolean {
  return (left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

export async function executeCmoRead(
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
  now: Date = new Date(),
): Promise<unknown> {
  const cuso = await cusoForRead(authorized);
  switch (input.capability) {
    case "read_calendar": {
      const query = SOKO_BOT_TOOL_INPUT_SCHEMAS.read_calendar.parse(
        input.input,
      );
      const from = query.from ?? isoDay(now);
      const to = query.to ?? isoDay(new Date(Date.parse(from) + 6 * DAY_MS));
      if (
        !query.ids &&
        (to < from || daysBetween(from, to) > MAX_CALENDAR_DAYS)
      )
        throw new SokoBotRuntimeValidationError(
          `Read at most ${MAX_CALENDAR_DAYS} days at once, with to on or after from.`,
        );
      const { plan, approved } = await workingPlan(authorized, cuso.projectId);
      if (!plan) return { pieces: [], note: "There is no strategy yet." };
      const ids = query.ids ? new Set(query.ids) : null;
      const matching = plan.calendar.filter(
        (entry) =>
          (ids
            ? ids.has(entry.id) ||
              (entry.socialPostId !== undefined && ids.has(entry.socialPostId))
            : entry.date >= from && entry.date <= to) &&
          (!query.network || same(entry.channel, query.network)) &&
          (!query.pillar || same(entry.pillar, query.pillar)) &&
          (!query.status || same(entry.status, query.status)),
      );
      const { items, more } = capped(matching);
      return {
        strategy: { month: plan.month, approved },
        ...(ids ? { ids: [...ids] } : { from, to }),
        pieces: items,
        matched: matching.length,
        ...(more > 0
          ? {
              more,
              note: `${more} more pieces match: read a narrower range, or narrow by network, pillar or status.`,
            }
          : {}),
        ...(matching.length === 0
          ? { note: "No piece matches: say so rather than guess." }
          : {}),
      };
    }
    case "read_strategy": {
      const { part } = SOKO_BOT_TOOL_INPUT_SCHEMAS.read_strategy.parse(
        input.input,
      );
      const { plan, approved } = await workingPlan(authorized, cuso.projectId);
      if (!plan)
        return { part, value: null, note: "There is no strategy yet." };
      const value = (plan as Record<string, unknown>)[part] ?? null;
      return {
        strategy: { month: plan.month, approved },
        part,
        value: cutText(value),
        ...(value === null ? { note: "This strategy has no such part." } : {}),
      };
    }
    case "read_brand_brain": {
      const { part } = SOKO_BOT_TOOL_INPUT_SCHEMAS.read_brand_brain.parse(
        input.input,
      );
      const brain = parseBrandBrain(cuso.brandBrain);
      if (!brain)
        return { part, value: null, note: "There is no Brand Brain yet." };
      const profile = brain.profile as Record<string, unknown>;
      const value =
        part in profile
          ? profile[part]
          : ((brain as Record<string, unknown>)[part] ?? null);
      return {
        part,
        value: cutText(value ?? null),
        ...(value === null || value === undefined
          ? { note: "The Brand Brain has nothing under this part yet." }
          : {}),
      };
    }
    case "read_report": {
      const query = SOKO_BOT_TOOL_INPUT_SCHEMAS.read_report.parse(input.input);
      const reports = await listCmoReports(
        authorized.turn.sokoBotId,
        query.id ? 100 : REPORTS_LISTED,
      );
      if (query.id) {
        const report = reports.find((candidate) => candidate.id === query.id);
        if (!report)
          throw new SokoBotRuntimeValidationError(
            "No report has this id: list them with read_report without id.",
          );
        const {
          previousVersionId: _previous,
          versionId: _version,
          ...shown
        } = report;
        return { report: cutText(shown) };
      }
      const listed = reports.filter(
        (report) =>
          (query.kind === "any" || report.kind === query.kind) &&
          (!query.from || report.at.slice(0, 10) >= query.from) &&
          (!query.to || report.at.slice(0, 10) <= query.to),
      );
      return {
        reports: listed.map((report) => ({
          id: report.id,
          at: report.at.slice(0, 10),
          kind: report.kind,
          headline: report.headline,
          ...(report.verdict ? { verdict: report.verdict } : {}),
        })),
        ...(listed.length === 0 ? { note: "No report matches." } : {}),
      };
    }
    case "read_competitor_moves": {
      const query = SOKO_BOT_TOOL_INPUT_SCHEMAS.read_competitor_moves.parse(
        input.input,
      );
      const moves = await recentCompetitorMoves(cuso.projectId, now, {
        ...(query.from ? { from: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to ? { to: new Date(`${query.to}T23:59:59Z`) } : {}),
        take: 60,
      });
      const matching = query.competitor
        ? moves.filter((move) =>
            (move.competitor ?? "")
              .toLowerCase()
              .includes((query.competitor as string).toLowerCase()),
          )
        : moves;
      const { items, more } = capped(matching);
      return {
        moves: items,
        ...(more > 0 ? { more } : {}),
        ...(matching.length === 0
          ? { note: "The competitor feed found no move here." }
          : {}),
      };
    }
    default:
      throw new SokoBotRuntimeValidationError("Not a CMO read.");
  }
}
