import type { ProjectSeoObservation } from "@sokosumi/database";
import { publicExplorationText } from "@sokosumi/utils";
import {
  queryContainsTopic,
  topicKey,
} from "@/helpers/seo-article-topic-phrases";
import type {
  ProjectSeoWorkspace,
  SeoActor,
  SeoWorkspaceQuery,
} from "@/schemas/project-seo.schema";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";

/** Keep observations of shared queries in a human viewer's response only. A single native read fixes the dates, property and search type. */
export function privateTopicQueries(
  actor: SeoActor,
  groups: ProjectSeoWorkspace["topicLaunches"],
  observations: ProjectSeoObservation[],
  query: SeoWorkspaceQuery,
) {
  if (actor.sokoBotId || !groups?.length || query.channel === "ai_assistant")
    return;
  const sources = observations
    .filter(
      (r) =>
        r.ownerId === actor.userId &&
        r.kind === "metrics" &&
        r.source === "search_console",
    )
    .map((row) => ({
      row,
      data: nativeSeoMetricsSchema.safeParse(row.payload).data,
    }));
  const evidence = groups.flatMap((group) => {
    const members = new Set(group.pages.map((p) => p.url));
    const source = sources.find(
      ({ data }) =>
        data?.provider === "search_console" &&
        (data.searchType ?? "web") === (query.searchType ?? "web") &&
        (!query.from || data.from === query.from) &&
        (!query.to || data.to === query.to) &&
        data.pageUrls.some((p) => members.has(p)),
    );
    if (
      !source?.data ||
      source.data.coverage !== "complete" ||
      source.data.channel !== "organic" ||
      !source.data.queries
    )
      return [];
    const { from, to, queries, pageUrls } = source.data;
    const matches = new Map<string, { query: string; pages: Set<string> }>();
    for (const row of queries.rows) {
      if (
        !pageUrls.includes(row.pageUrl) ||
        !members.has(row.pageUrl) ||
        row.impressions <= 0 ||
        row.clicks > row.impressions ||
        row.query.length > 256 ||
        !publicExplorationText(row.query) ||
        !queryContainsTopic(row.query, group.topic)
      )
        continue;
      const key = topicKey(row.query);
      const item = matches.get(key) ?? {
        query: row.query,
        pages: new Set<string>(),
      };
      item.pages.add(row.pageUrl);
      matches.set(key, item);
    }
    const found = [...matches.values()]
      .filter((m) => m.pages.size >= 2)
      .sort(
        (a, b) => b.pages.size - a.pages.size || a.query.localeCompare(b.query),
      )[0];
    return found
      ? [
          {
            topic: group.topic,
            query: found.query,
            from,
            to,
            pages: [...found.pages].sort(),
            observationId: source.row.id,
          },
        ]
      : [];
  });
  return evidence.length ? evidence : undefined;
}
