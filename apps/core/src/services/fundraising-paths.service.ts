/**
 * Warm paths to an investor, from what the workspace already knows: the
 * teammates who have been in touch with them, the contacts at their fund, and
 * the contacts at the companies they backed, each with who on the team
 * knows that person and how well. The portfolio comes from one Exa agent run
 * per investor, kept with its sources and refreshed on request.
 */
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
import type {
  FundraisingPathDto,
  FundraisingPathsDto,
} from "@/schemas/fundraising.schema";
import {
  CONTACT_INCLUDE,
  contactCompanyMemberIds,
  contactDtos,
} from "@/services/contacts.service";
import {
  type FundraisingActor,
  INVESTORS_LIST_NAME_KEY,
} from "@/services/fundraising.service";
import { researchStatus } from "@/services/fundraising-research.service";

const RESEARCH_EFFORT = "medium";
export const PORTFOLIO_RESEARCH_USD = EXA_AGENT_EFFORT_USD[RESEARCH_EFFORT];
const COMPANIES_MATCHED = 25;
const PEOPLE_PER_COMPANY = 40;
const PATHS_SHOWN = 30;

type ContactDto = Awaited<ReturnType<typeof contactDtos>>[number];

const PORTFOLIO_SYSTEM = `You list the companies an investment firm has invested in.
Only companies named on a page you read: the firm's portfolio page, a funding announcement, a reputable news article. Never invent a company, a round, a date or a URL. One row per company; the most recent investments first. round as announced ("Seed", "Series A"); date as "YYYY-MM" or "YYYY"; amount_usd only when the page states it. source_url is the page that names the investment. Leave a field out when the page does not say it.`;

const portfolioSchema = {
  type: "object",
  properties: {
    companies: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          website: { type: "string" },
          round: { type: "string" },
          date: { type: "string" },
          amount_usd: { type: "number" },
          source_url: { type: "string" },
        },
        required: ["name", "source_url"],
      },
    },
  },
  required: ["companies"],
};

export interface FoundPortfolioCompany {
  name: string;
  website: string | null;
  round: string | null;
  date: string | null;
  amountUsd: number | null;
  sourceUrl: string;
}

function str(value: unknown, max = 200): string | null {
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

/** The agent's answer as companies; one row per name, rows without a source dropped. */
export function parsePortfolio(structured: unknown): FoundPortfolioCompany[] {
  const rows =
    structured && typeof structured === "object"
      ? (structured as { companies?: unknown }).companies
      : null;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const name = str(item.name);
    const sourceUrl = url(item.source_url);
    if (!name || !sourceUrl) return [];
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!key || seen.has(key)) return [];
    seen.add(key);
    const amount = item.amount_usd;
    return [
      {
        name,
        website: url(item.website),
        round: str(item.round, 60),
        date: str(item.date, 20),
        amountUsd:
          typeof amount === "number" && Number.isFinite(amount) && amount > 0
            ? Math.round(amount)
            : null,
        sourceUrl,
      },
    ];
  });
}

async function requireInvestor(actor: FundraisingActor, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      workspaceId: actor.workspaceId,
      archivedAt: null,
      mergedIntoId: null,
      listMemberships: {
        some: { list: { nameKey: INVESTORS_LIST_NAME_KEY } },
      },
    },
    include: CONTACT_INCLUDE,
  });
  if (!contact) throw notFound("This person is not on the Investors list");
  return contact;
}

const DECIDER =
  /\b(founder|co-founder|ceo|cto|coo|cfo|partner|managing director|general partner|principal|president)\b/i;

/** A DTO date, which may still be a Date or an ISO string before the schema runs. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) return new Date(value);
  return null;
}

function daysSince(date: Date | null, now: Date): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return (now.getTime() - date.getTime()) / 864e5;
}

/**
 * How much to trust a path: how often the team talked to the person, how
 * recently, whether they decide things, and how close they sit to the
 * investor (direct, the fund, a portfolio company).
 */
export function pathStrength(
  input: {
    kind: FundraisingPathDto["kind"];
    touches: number;
    lastTouchAt: Date | null;
    familiarity: number | null;
    role: string | null;
    linkedIn?: boolean;
  },
  now = new Date(),
): number {
  let score = Math.min(50, input.touches * 6);
  score = Math.max(score, Math.round((input.familiarity ?? 0) / 2));
  const age = daysSince(input.lastTouchAt, now);
  if (age <= 30) score += 25;
  else if (age <= 90) score += 15;
  else if (age <= 365) score += 5;
  if (input.role && DECIDER.test(input.role)) score += 10;
  if (input.linkedIn) score += 15;
  if (input.kind === "direct" || input.kind === "linkedin") score += 20;
  else if (input.kind === "fund") score += 10;
  return Math.max(0, Math.min(100, score));
}

function person(
  contact: ContactDto,
): NonNullable<FundraisingPathDto["through"]> {
  const email =
    contact.channels.find((c) => c.type === "EMAIL" && c.isPrimary) ??
    contact.channels.find((c) => c.type === "EMAIL");
  return {
    id: contact.id,
    name: contact.name,
    role: contact.role,
    organization: contact.organization,
    avatarUrl: contact.avatarUrl,
    email: email?.value ?? null,
  };
}

/** Paths through a contact: the teammate who knows them best, or nobody yet. */
type Teammate = NonNullable<FundraisingPathDto["via"]>;

/** Paths through a contact: the teammate who knows them best, else one connected on LinkedIn, else nobody yet. */
function pathsThrough(
  kind: FundraisingPathDto["kind"],
  contact: ContactDto,
  company: FundraisingPathDto["company"],
  connections: Map<string, Teammate[]>,
  now: Date,
): FundraisingPathDto[] {
  const known = contact.knownBy[0];
  const connected = connections.get(contact.id) ?? [];
  const via: Teammate | null = known
    ? { id: known.id, name: known.name, image: known.image }
    : (connected[0] ?? null);
  const linkedIn = via ? connected.some((t) => t.id === via.id) : false;
  const touches = contact.knownBy.reduce(
    (sum, k) => sum + k.interactionCount,
    0,
  );
  const lastTouchAt = toDate(known?.lastInteractionAt);
  return [
    {
      kind,
      via,
      linkedIn,
      through: person(contact),
      company,
      strength: pathStrength(
        {
          kind,
          touches,
          lastTouchAt,
          familiarity: contact.score?.familiarity ?? null,
          role: contact.role,
          linkedIn,
        },
        now,
      ),
      touches,
      lastTouchAt,
    },
  ];
}

/** Which teammates are connected to each contact on LinkedIn. */
async function linkedInConnections(
  contactIds: string[],
): Promise<Map<string, Teammate[]>> {
  const result = new Map<string, Teammate[]>();
  if (!contactIds.length) return result;
  const rows = await prisma.contactLinkedInConnection.findMany({
    where: { contactId: { in: contactIds } },
    include: { user: { select: { id: true, name: true, image: true } } },
    orderBy: { connectedOn: "desc" },
  });
  for (const row of rows) {
    const list = result.get(row.contactId) ?? [];
    list.push(row.user);
    result.set(row.contactId, list);
  }
  return result;
}

/** The investor's portfolio and every path the workspace has to them, strongest first. */
export async function warmPaths(
  actor: FundraisingActor,
  contactId: string,
  now = new Date(),
): Promise<FundraisingPathsDto> {
  const investorRow = await requireInvestor(actor, contactId);
  const [investor] = await contactDtos([investorRow], prisma, actor.userId);
  if (!investor) throw notFound("Contact not found");
  const [portfolio, research] = await Promise.all([
    prisma.fundraisingPortfolioCompany.findMany({
      where: { contactId },
      orderBy: [{ date: "desc" }, { name: "asc" }],
    }),
    researchStatus(actor),
  ]);

  const investorConnections =
    (await linkedInConnections([contactId])).get(contactId) ?? [];
  const paths: FundraisingPathDto[] = investor.knownBy.map((known) => {
    const lastTouchAt = toDate(known.lastInteractionAt);
    const linkedIn = investorConnections.some((t) => t.id === known.id);
    return {
      kind: "direct",
      via: { id: known.id, name: known.name, image: known.image },
      linkedIn,
      through: null,
      company: null,
      strength: pathStrength(
        {
          kind: "direct",
          touches: known.interactionCount,
          lastTouchAt,
          familiarity: investor.score?.familiarity ?? null,
          role: investor.role,
          linkedIn,
        },
        now,
      ),
      touches: known.interactionCount,
      lastTouchAt,
    };
  });
  for (const teammate of investorConnections) {
    if (investor.knownBy.some((known) => known.id === teammate.id)) continue;
    paths.push({
      kind: "linkedin",
      via: teammate,
      linkedIn: true,
      through: null,
      company: null,
      strength: pathStrength(
        {
          kind: "linkedin",
          touches: 0,
          lastTouchAt: null,
          familiarity: null,
          role: investor.role,
          linkedIn: true,
        },
        now,
      ),
      touches: 0,
      lastTouchAt: null,
    });
  }

  const companies: {
    kind: FundraisingPathDto["kind"];
    name: string;
    company: FundraisingPathDto["company"];
  }[] = [];
  if (investor.organization)
    companies.push({
      kind: "fund",
      name: investor.organization,
      company: { name: investor.organization, round: null, date: null },
    });
  for (const row of portfolio.slice(0, COMPANIES_MATCHED))
    companies.push({
      kind: "portfolio",
      name: row.name,
      company: { name: row.name, round: row.round, date: row.date },
    });

  const idsByCompany = await Promise.all(
    companies.map(async (company) => ({
      company,
      ids: (await contactCompanyMemberIds(actor.workspaceId, company.name))
        .filter((id) => id !== contactId)
        .slice(0, PEOPLE_PER_COMPANY),
    })),
  );
  const allIds = [...new Set(idsByCompany.flatMap((entry) => entry.ids))];
  const rows = allIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: allIds }, archivedAt: null, mergedIntoId: null },
        include: CONTACT_INCLUDE,
      })
    : [];
  const [dtos, connections] = await Promise.all([
    contactDtos(rows, prisma, actor.userId),
    linkedInConnections(allIds),
  ]);
  const byId = new Map(dtos.map((c) => [c.id, c]));
  const placed = new Set<string>();
  for (const { company, ids } of idsByCompany) {
    for (const id of ids) {
      const contact = byId.get(id);
      if (!contact || placed.has(id)) continue;
      placed.add(id);
      paths.push(
        ...pathsThrough(
          company.kind,
          contact,
          company.company,
          connections,
          now,
        ),
      );
    }
  }
  paths.sort(
    (a, b) =>
      b.strength - a.strength ||
      (toDate(b.lastTouchAt)?.getTime() ?? 0) -
        (toDate(a.lastTouchAt)?.getTime() ?? 0),
  );
  return {
    portfolio,
    researchedAt: portfolio[0]?.fetchedAt ?? null,
    researchUsd: PORTFOLIO_RESEARCH_USD,
    paths: paths.slice(0, PATHS_SHOWN),
    research,
  };
}

export interface PortfolioResearchDeps {
  run: (input: Parameters<typeof runExaAgent>[0]) => Promise<ExaAgentRunResult>;
}

/**
 * One Exa agent run for the investor's portfolio, replacing what was there.
 * The run and its cost are recorded whatever it found.
 */
export async function researchPortfolio(
  actor: FundraisingActor,
  contactId: string,
  deps: PortfolioResearchDeps = { run: runExaAgent },
): Promise<FundraisingPathsDto> {
  const investor = await requireInvestor(actor, contactId);
  if (!investor.organization)
    throw unprocessableEntity(
      "Add the fund to this contact first; the research looks the fund up",
    );
  const status = await researchStatus(actor);
  if (!status.exaConfigured)
    throw unprocessableEntity("Exa is not configured on this Core");
  if (status.monthUsd + PORTFOLIO_RESEARCH_USD > status.capUsd)
    throw unprocessableEntity(
      `This month's research budget of $${status.capUsd} is used up ($${status.monthUsd.toFixed(2)} spent). Raise FUNDRAISING_EXA_MONTHLY_CAP_USD to keep researching.`,
    );
  const site = investor.channels.find((c) => c.type === "WEBSITE")?.value;
  const result = await deps
    .run({
      query: `Which companies has ${investor.organization}${site ? ` (${site})` : ""} invested in? ${investor.name}${investor.role ? `, ${investor.role}` : ""} works there. List up to 30 investments, newest first, each with the round, the date and the page that names it.`,
      systemPrompt: PORTFOLIO_SYSTEM,
      effort: RESEARCH_EFFORT,
      outputSchema: portfolioSchema,
      userIdentifier: `fundraising:${actor.workspaceId}`,
    })
    .catch((error: unknown) => {
      if (error instanceof ExaUnavailableError)
        throw serviceUnavailable(
          `The research did not run: ${error.message}. Nothing was charged.`,
        );
      throw error;
    });
  const companies = parsePortfolio(result.structured);
  const list = await prisma.contactList.findFirst({
    where: { workspaceId: actor.workspaceId, nameKey: INVESTORS_LIST_NAME_KEY },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.contactPeopleSearch.create({
      data: {
        workspaceId: actor.workspaceId,
        listId: list?.id ?? null,
        contactId,
        query: `Portfolio of ${investor.organization}`,
        requested: 1,
        found: companies.length,
        costUsdMicros: Math.round(result.costUsd * 1_000_000),
        createdByUserId: actor.userId,
      },
    });
    await tx.fundraisingPortfolioCompany.deleteMany({ where: { contactId } });
    if (companies.length)
      await tx.fundraisingPortfolioCompany.createMany({
        data: companies.map((company) => ({
          workspaceId: actor.workspaceId,
          contactId,
          ...company,
        })),
      });
  });
  return warmPaths(actor, contactId);
}
