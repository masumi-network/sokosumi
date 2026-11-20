import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

export function seoMarketEvidence(
  data: ProjectSeoWorkspace,
  pageId?: string | null,
) {
  const selected = new Set(pageId ? [pageId] : data.scope.pageIds);
  const observations = data.observations
    .filter(
      (observation) =>
        observation.pageIds.length &&
        observation.pageIds.every((id) => selected.has(id)),
    )
    .sort(
      (a, b) =>
        new Date(b.observedAt).valueOf() - new Date(a.observedAt).valueOf(),
    );
  const strategy = data.strategy;
  const site =
    !pageId || observations.some((o) => o.id === strategy?.observationId)
      ? strategy
      : null;
  const page = observations.find((o) => o.pageMarketEvidence);
  const selectedUrls = new Set(
    data.pages.filter((p) => selected.has(p.id)).map((p) => p.url),
  );
  const captured = new Map(
    data.auditSearchConsole
      ?.filter(
        (e) =>
          e.countries &&
          e.coverage !== "unavailable" &&
          e.pageUrls.length &&
          e.pageUrls.every((url) => selectedUrls.has(url)),
      )
      .map((e) => [e.taskId, e]),
  );
  const observation = observations.find(
    (o) =>
      o.kind === "audit_full" &&
      o.countryCode &&
      o.sourceTaskId &&
      captured.has(o.sourceTaskId),
  );
  const evidence = observation?.sourceTaskId
    ? captured.get(observation.sourceTaskId)
    : undefined;
  const foreign =
    evidence?.countries?.rows
      .filter(
        (row) =>
          row.key !== observation?.countryCode &&
          /^[A-Z]{2}$/.test(row.key) &&
          row.key !== "ZZ" &&
          (row.impressions > 0 || row.clicks > 0),
      )
      .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks) ??
    [];
  const pageUrl =
    page && data.pages.find(({ id }) => id === page.pageIds[0])?.url;
  return { site, page, pageUrl, evidence, foreign };
}
