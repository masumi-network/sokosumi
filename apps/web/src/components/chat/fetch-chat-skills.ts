import type { ChatSkillCatalogItem } from "@sokosumi/core-client";
import { searchChatSkillsResponseTransformer } from "@sokosumi/core-client/transformers";

import { fetchBackgroundJson } from "./fetch-background-json";

const SKILL_SEARCH_TIMEOUT_MS = 10_000;

/** Skills for the composer picker; null when the search could not be read. */
export async function fetchChatSkills(
  query: string,
): Promise<ChatSkillCatalogItem[] | null> {
  const data = await fetchBackgroundJson(
    `/api/chat/skills?q=${encodeURIComponent(query.trim())}`,
    SKILL_SEARCH_TIMEOUT_MS,
  );
  if (data == null) return null;
  try {
    return (await searchChatSkillsResponseTransformer(data)).data;
  } catch {
    return null;
  }
}
