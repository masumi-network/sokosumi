/**
 * Finding investors for the raise with Exa's agent: one run per search, a
 * JSON answer of people with a reason and a source, kept as suggestions on
 * the Investors list until someone adds or dismisses them. Every run's cost
 * is recorded, and a month's spend has a cap.
 */
import { Prisma } from "@sokosumi/database";
import { getEnv } from "@/config/env";
import {
  notFound,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  EXA_AGENT_EFFORT_USD,
  type ExaAgentRunResult,
  runExaAgent,
} from "@/lib/exa-agent";
import { ExaUnavailableError } from "@/lib/soko-bot/exa";
import type { FundraisingResearchDto } from "@/schemas/fundraising.schema";
import {
  addContactSuggestions,
  type ContactSuggestionDto,
  dismissContactSuggestions,
  listContactSuggestions,
  profileKey,
} from "@/services/contact-suggestions.service";
import {
  type FundraisingActor,
  INVESTORS_LIST_NAME_KEY,
} from "@/services/fundraising.service";

/** Thorough enough to read fund pages and news; a flat price per run. */
const SEARCH_EFFORT = "high";
export const INVESTOR_SEARCH_USD = EXA_AGENT_EFFORT_USD[SEARCH_EFFORT];
export const FOUND_WITH_EXA = "Found with Exa";

const SEARCH_SYSTEM = `You find investors for a startup's fundraise.
Only real people who invest today: partners, principals or associates at venture funds, or angels who write cheques. Each one must come from a page you read: a fund's team page, a portfolio or deal announcement, an interview. Never invent a person, a fund, a deal or a URL.
Leave out anyone whose evidence shows they do not fit the brief: wrong stage, wrong region, no longer investing. evidence: one sentence, at most 30 words, stating the concrete fact that makes them fit (a deal, a stated focus, a fund thesis); facts only, never a list of what you could not verify. linkedin_url: their LinkedIn profile when you find it; leave it out otherwise. source_url: the page the evidence comes from.
Skip the people the brief lists as already known.`;

const investorsSchema = (size: number) => ({
  type: "object",
  properties: {
    investors: {
      type: "array",
      maxItems: size,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          firm: { type: "string" },
          firm_website: { type: "string" },
          linkedin_url: { type: "string" },
          location: { type: "string" },
          evidence: { type: "string" },
          source_url: { type: "string" },
        },
        required: ["name", "firm", "evidence", "source_url"],
      },
    },
  },
  required: ["investors"],
});

export interface FoundInvestor {
  name: string;
  title: string | null;
  firm: string;
  firmWebsite: string | null;
  linkedinUrl: string | null;
  location: string | null;
  evidence: string;
  sourceUrl: string;
}

function str(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function url(value: unknown): string | null {
  const text = str(value, 2000);
  if (!text) return null;
  try {
    const parsed = new URL(text.startsWith("http") ? text : `https://${text}`);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/** The agent's answer as investors; rows without a name, firm, evidence and source are dropped. */
export function parseFoundInvestors(structured: unknown): FoundInvestor[] {
  const rows =
    structured && typeof structured === "object"
      ? (structured as { investors?: unknown }).investors
      : null;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const name = str(item.name, 200);
    const firm = str(item.firm, 200);
    const evidence = str(item.evidence, 300);
    const sourceUrl = url(item.source_url);
    if (!name || !firm || !evidence || !sourceUrl) return [];
    return [
      {
        name,
        title: str(item.title, 200),
        firm,
        firmWebsite: url(item.firm_website),
        linkedinUrl: url(item.linkedin_url),
        location: str(item.location, 200),
        evidence,
        sourceUrl,
      },
    ];
  });
}

/** The page a suggestion is keyed by: LinkedIn when known, else the source. */
export function investorProfileUrl(investor: FoundInvestor): string {
  return investor.linkedinUrl ?? investor.sourceUrl;
}

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** This month's Exa research spend in the workspace, from every recorded run. */
export async function researchStatus(
  actor: Pick<FundraisingActor, "workspaceId">,
): Promise<FundraisingResearchDto> {
  const spent = await prisma.contactPeopleSearch.aggregate({
    where: { workspaceId: actor.workspaceId, createdAt: { gte: monthStart() } },
    _sum: { costUsdMicros: true },
  });
  const env = getEnv();
  return {
    monthUsd: (spent._sum.costUsdMicros ?? 0) / 1_000_000,
    capUsd: env.FUNDRAISING_EXA_MONTHLY_CAP_USD,
    perSearchUsd: INVESTOR_SEARCH_USD,
    exaConfigured: Boolean(env.EXA_API_KEY),
  };
}

async function requireInvestorsList(actor: FundraisingActor) {
  const list = await prisma.contactList.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      nameKey: INVESTORS_LIST_NAME_KEY,
      smartFilter: { equals: Prisma.DbNull },
    },
    select: { id: true, name: true },
  });
  if (!list) throw notFound("Make a contact list named Investors first");
  return list;
}

export interface FindInvestorsDeps {
  run: (input: Parameters<typeof runExaAgent>[0]) => Promise<ExaAgentRunResult>;
}

/**
 * One Exa agent search for investors who fit the brief, kept as suggestions
 * on the Investors list. People already on the list or already suggested are
 * skipped; the run and its cost are recorded whatever it found.
 */
export async function findInvestors(
  actor: FundraisingActor,
  input: { brief: string; size: 10 | 25 },
  deps: FindInvestorsDeps = { run: runExaAgent },
): Promise<{
  found: number;
  costUsd: number;
  research: FundraisingResearchDto;
}> {
  const list = await requireInvestorsList(actor);
  const status = await researchStatus(actor);
  if (!status.exaConfigured)
    throw unprocessableEntity("Exa is not configured on this Core");
  if (status.monthUsd + INVESTOR_SEARCH_USD > status.capUsd)
    throw unprocessableEntity(
      `This month's research budget of $${status.capUsd} is used up ($${status.monthUsd.toFixed(2)} spent). Raise FUNDRAISING_EXA_MONTHLY_CAP_USD to keep searching.`,
    );

  const [suggested, members] = await Promise.all([
    prisma.contactSuggestion.findMany({
      where: { listId: list.id },
      select: { profileKey: true, name: true },
    }),
    prisma.contact.findMany({
      where: {
        workspaceId: actor.workspaceId,
        archivedAt: null,
        mergedIntoId: null,
        listMemberships: { some: { listId: list.id } },
      },
      select: {
        name: true,
        organization: true,
        channels: {
          where: { type: { in: ["LINKEDIN", "WEBSITE"] } },
          select: { value: true },
        },
      },
    }),
  ]);
  const skipKeys = new Set([
    ...suggested.map((row) => row.profileKey),
    ...members.flatMap((row) =>
      row.channels.flatMap((channel) => profileKey(channel.value) ?? []),
    ),
  ]);
  const skipNames = new Set(
    [
      ...suggested.map((row) => row.name),
      ...members.map((row) => row.name),
    ].map((name) => name.trim().toLowerCase()),
  );
  const known = members
    .slice(0, 80)
    .map((row) =>
      row.organization ? `${row.name} (${row.organization})` : row.name,
    );

  const result = await deps
    .run({
      query: `Find ${input.size} investors who fit this brief:\n${input.brief}\n\nAlready known, skip them: ${known.join("; ") || "nobody yet"}.`,
      systemPrompt: SEARCH_SYSTEM,
      effort: SEARCH_EFFORT,
      outputSchema: investorsSchema(input.size),
      userIdentifier: `fundraising:${actor.workspaceId}`,
    })
    .catch((error: unknown) => {
      if (error instanceof ExaUnavailableError)
        throw serviceUnavailable(
          `The search did not run: ${error.message}. Nothing was charged.`,
        );
      throw error;
    });
  const seen = new Set<string>();
  const fresh = parseFoundInvestors(result.structured).filter((investor) => {
    const key = profileKey(investorProfileUrl(investor));
    const nameKey = investor.name.toLowerCase();
    if (!key || skipKeys.has(key) || skipNames.has(nameKey) || seen.has(key))
      return false;
    seen.add(key);
    return true;
  });

  const run = await prisma.contactPeopleSearch.create({
    data: {
      workspaceId: actor.workspaceId,
      listId: list.id,
      query: input.brief,
      requested: input.size,
      found: fresh.length,
      costUsdMicros: Math.round(result.costUsd * 1_000_000),
      createdByUserId: actor.userId,
    },
    select: { id: true },
  });
  if (fresh.length)
    await prisma.contactSuggestion.createMany({
      data: fresh.map((investor) => ({
        workspaceId: actor.workspaceId,
        listId: list.id,
        searchId: run.id,
        profileKey: profileKey(investorProfileUrl(investor)) ?? "",
        profileUrl: investorProfileUrl(investor),
        name: investor.name,
        role: investor.title,
        organization: investor.firm,
        location: investor.location,
        reason: investor.evidence,
      })),
      skipDuplicates: true,
    });
  return {
    found: fresh.length,
    costUsd: result.costUsd,
    research: await researchStatus(actor),
  };
}

export async function listInvestorSuggestions(
  actor: FundraisingActor,
): Promise<ContactSuggestionDto[]> {
  const list = await requireInvestorsList(actor);
  return listContactSuggestions(actor, list.id);
}

/** Adds the suggestions to Contacts and the list, and marks where they came from. */
export async function addInvestorSuggestions(
  actor: FundraisingActor,
  ids: readonly string[],
): Promise<{ added: number }> {
  const list = await requireInvestorsList(actor);
  const result = await addContactSuggestions(actor, list.id, ids);
  const added = await prisma.contactSuggestion.findMany({
    where: { id: { in: [...ids] }, listId: list.id, status: "ADDED" },
    select: { contactId: true },
  });
  for (const { contactId } of added) {
    if (!contactId) continue;
    await prisma.fundraisingProspect.upsert({
      where: { contactId },
      create: {
        workspaceId: actor.workspaceId,
        contactId,
        source: FOUND_WITH_EXA,
      },
      update: {},
    });
  }
  return result;
}

export async function dismissInvestorSuggestions(
  actor: FundraisingActor,
  ids: readonly string[],
): Promise<{ dismissed: number }> {
  const list = await requireInvestorsList(actor);
  return dismissContactSuggestions(actor, list.id, ids);
}
