import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

const dayMs = 86_400_000;
type Article = NonNullable<ProjectSeoWorkspace["articleDates"]>[number];

export function seoArticleHistory(workspace: ProjectSeoWorkspace) {
  const selected = new Set(workspace.scope.pageIds);
  const pages = new Map(
    workspace.pages.filter((p) => selected.has(p.id)).map((p) => [p.url, p.id]),
  );
  const articles = (workspace.articleDates ?? []).filter((p) =>
    pages.has(p.url),
  );
  const available = new Set(articles.map((p) => p.url));
  const grouped = new Set<string>();
  const groups = new Map<
    string,
    NonNullable<ProjectSeoWorkspace["topicLaunches"]>
  >();
  for (const group of workspace.topicLaunches ?? []) {
    if (!group.pages.length || !group.pages.every((p) => available.has(p.url)))
      continue;
    const earlierArticle =
      group.earlierArticle && available.has(group.earlierArticle.url)
        ? group.earlierArticle
        : undefined;
    const label = group.topic
      .normalize("NFKC")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
    groups.set(label, [
      ...(groups.get(label) ?? []),
      { ...group, earlierArticle },
    ]);
    for (const p of group.pages) grouped.add(p.url);
    if (earlierArticle) grouped.add(earlierArticle.url);
  }
  function ageAtAudit(article: Article) {
    const id = pages.get(article.url);
    const audit =
      id &&
      workspace.observations.find(
        (row) => row.kind === "audit_full" && row.pageIds.includes(id),
      );
    if (!audit) return;
    const date = new Date(audit.observedAt);
    const days =
      (Date.parse(date.toISOString().slice(0, 10)) -
        new Date(article.publishedOn).getTime()) /
      dayMs;
    if (days >= 0) return { days, date };
  }
  return {
    groups,
    singles: articles.filter((p) => !grouped.has(p.url)),
    ageAtAudit,
  };
}
