import type { sokoBotSearchExaInputSchema } from "@sokosumi/soko-bot";
import type { z } from "zod";

import { getEnv } from "@/config/env";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_RESULTS = 8;
/** Passages per result: enough to quote, short enough to keep turns cheap. */
const PASSAGE_CHARS = 700;
const DESCRIPTION_CHARS = 400;
const RETRY_MS = 1_500;

export type ExaSearchInput = z.infer<typeof sokoBotSearchExaInputSchema>;

export interface ExaCompany {
  name?: string;
  foundedYear?: number;
  employees?: string;
  headquarters?: string;
  description?: string;
}

export interface ExaSearchResult {
  results: {
    title: string;
    url: string;
    publishedDate?: string;
    author?: string;
    passages: string[];
    company?: ExaCompany;
  }[];
  /** What Exa charged for this search, in US dollars. */
  costUsd: number;
}

export class ExaUnavailableError extends Error {}

/** Company and people searches reject a publish date with a 400. */
const UNDATED_CATEGORIES = new Set(["company", "people"]);

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

/** "workforce: { total: 40 }" and "headquarters: { city, country }" as plain text. */
function plain(value: unknown): string | undefined {
  const direct = text(value);
  if (direct || !value || typeof value !== "object") return direct;
  const parts = Object.values(value as Record<string, unknown>)
    .map(text)
    .filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function company(entities: unknown): ExaCompany | undefined {
  if (!Array.isArray(entities)) return undefined;
  const entity = entities.find(
    (item) => item && typeof item === "object" && item.type === "company",
  ) as { properties?: Record<string, unknown> } | undefined;
  const properties = entity?.properties;
  if (!properties) return undefined;
  const description = text(properties.description);
  return {
    name: text(properties.name),
    foundedYear:
      typeof properties.foundedYear === "number"
        ? properties.foundedYear
        : undefined,
    employees: plain(properties.workforce),
    headquarters: plain(properties.headquarters),
    description: description ? clip(description, DESCRIPTION_CHARS) : undefined,
  };
}

/**
 * One Exa search with the most relevant passages of each result, as Exa's
 * agent guidance recommends: highlights instead of full pages, descriptive
 * queries, categories for companies, news and people.
 */
export async function searchExa(
  input: ExaSearchInput,
  options: { userIdentifier?: string } = {},
): Promise<ExaSearchResult> {
  const key = getEnv().EXA_API_KEY;
  if (!key) throw new ExaUnavailableError("Exa is not configured");
  const dated = !input.category || !UNDATED_CATEGORIES.has(input.category);
  const body = {
    query: input.query,
    type: "auto",
    numResults: input.numResults ?? DEFAULT_RESULTS,
    category: input.category,
    includeDomains: input.includeDomains,
    excludeDomains: input.excludeDomains,
    startPublishedDate:
      dated && input.startPublishedDate
        ? `${input.startPublishedDate}T00:00:00.000Z`
        : undefined,
    contents: { highlights: { maxCharacters: PASSAGE_CHARS } },
    userIdentifier: options.userIdentifier?.slice(0, 64),
  };
  const request = () =>
    fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  let response = await request();
  // Exa's limits are shared per team; one short wait clears most bursts.
  if (response.status === 429) {
    const wait = Number(response.headers.get("retry-after")) * 1000;
    await new Promise((resolve) =>
      setTimeout(resolve, Number.isFinite(wait) && wait > 0 ? wait : RETRY_MS),
    );
    response = await request();
  }
  if (!response.ok) {
    throw new ExaUnavailableError(`Exa search failed (${response.status})`);
  }
  const data = (await response.json()) as {
    results?: Record<string, unknown>[];
    costDollars?: { total?: unknown };
  };
  return {
    results: (data.results ?? []).map((result) => ({
      title: text(result.title) ?? text(result.url) ?? "",
      url: text(result.url) ?? "",
      publishedDate: text(result.publishedDate)?.slice(0, 10),
      author: text(result.author),
      passages: Array.isArray(result.highlights)
        ? result.highlights
            .map(text)
            .filter((passage): passage is string => Boolean(passage))
            .map((passage) => clip(passage, PASSAGE_CHARS))
        : [],
      company: company(result.entities),
    })),
    costUsd:
      typeof data.costDollars?.total === "number" ? data.costDollars.total : 0,
  };
}
