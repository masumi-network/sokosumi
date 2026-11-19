import { unprocessableEntity } from "@/helpers/error";
import { readCompetitorPage } from "@/lib/competitors/page-read";
import {
  businessAbout,
  type CompetitorSuggestion,
  type KnownCompetitor,
  mergeSuggestions,
  pickCompetitors,
  SUGGESTION_CANDIDATES,
  suggestionCandidates,
  suggestionQuery,
} from "@/lib/competitors/suggest";
import { bareHost, squash } from "@/lib/competitors/text";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";
import { ExaUnavailableError, searchExa } from "@/lib/soko-bot/exa";

/**
 * A competitor the model named is suggested only when its site loads and
 * names it: the address came from the model, not from a search result.
 */
async function verified(
  known: KnownCompetitor,
): Promise<CompetitorSuggestion | null> {
  try {
    const page = await readCompetitorPage(known.websiteUrl);
    const final = page ? URL.parse(page.url) : null;
    if (!page || !final) return null;
    const [firstWord = ""] = known.name.split(/\s+/);
    const says = squash(`${final.hostname} ${page.lines.join(" ")}`);
    if (!says.includes(squash(firstWord))) return null;
    return { ...known, websiteUrl: new URL("/", final).href };
  } catch {
    return null;
  }
}

/**
 * Competitors a Project could track, found from its website: a company
 * search for businesses like it, sorted by a model that may add well-known
 * ones the search missed. Nothing is stored; the member picks which to add.
 * One run costs about a cent (an Exa search and one model call) and is not
 * charged.
 */
export async function suggestCompetitors(
  projectId: string,
): Promise<CompetitorSuggestion[]> {
  const [project, tracked] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { name: true, websiteUrl: true },
    }),
    // Removed ones too: the member already said no to them.
    prisma.trackedCompetitor.findMany({
      where: { projectId },
      select: { name: true, websiteUrl: true },
    }),
  ]);
  const site = project.websiteUrl ? URL.parse(project.websiteUrl) : null;
  if (!site)
    throw unprocessableEntity(
      "Add the project's website first: competitors are found from what it sells.",
    );
  const host = bareHost(site.hostname);
  const page = await readCompetitorPage(site.href).catch(() => null);
  const business = {
    name: project.name,
    about: page ? businessAbout(page.lines) : "",
  };
  const skip = {
    hosts: [
      host,
      ...tracked.flatMap(({ websiteUrl }) => {
        const url = websiteUrl ? URL.parse(websiteUrl) : null;
        return url ? [url.hostname] : [];
      }),
    ],
    names: [project.name, ...tracked.map(({ name }) => name)],
  };
  let found: Awaited<ReturnType<typeof searchExa>>;
  try {
    found = await searchExa(
      {
        query: suggestionQuery({ ...business, host }),
        category: "company",
        numResults: SUGGESTION_CANDIDATES,
        excludeDomains: [host],
      },
      { userIdentifier: projectId },
    );
  } catch (error) {
    if (error instanceof ExaUnavailableError)
      throw unprocessableEntity(
        "Competitors cannot be searched for right now. Add them by hand.",
      );
    throw error;
  }
  const picked = await pickCompetitors(
    business,
    suggestionCandidates(found.results, skip),
  );
  const known = (await Promise.all(picked.known.map(verified))).flatMap(
    (suggestion) => (suggestion ? [suggestion] : []),
  );
  const suggestions = mergeSuggestions(known, picked.suggestions, skip);
  createCoreLogger({
    operation: "competitor_suggestions",
    project: { id: projectId },
    competitorSuggestions: {
      candidates: found.results.length,
      suggested: suggestions.length,
      costUsd: found.costUsd + picked.costUsd,
    },
  }).emit();
  return suggestions;
}
