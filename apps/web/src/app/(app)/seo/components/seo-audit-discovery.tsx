import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { seoWorkspaceOwner } from "@/lib/seo/owner";
import { SeoConsoleExportActions } from "./seo-console-export-actions";
import { SeoPropertyPageDiscovery } from "./seo-property-page-discovery";
import { SeoFoldSummary } from "./seo-shared";

type Evidence = NonNullable<
  NonNullable<ProjectSeoWorkspace["auditSearchConsole"]>[number]["discovery"]
>;

const day = (value: Date | string) =>
  new Date(value).toISOString().slice(0, 10);

export function SeoDiscoveryActions({ evidence }: { evidence: Evidence }) {
  const t = useSeoResultTranslations("App.Seo.discovery");
  if (!evidence.actions.length && !evidence.changes.length) return null;
  return (
    <section lang="en" className="space-y-2">
      <h4 className="font-medium">{t("actions")}</h4>
      {evidence.actions.length > 0 && (
        <ul className="space-y-2">
          {evidence.actions.map((a) => (
            <li key={a.url + a.action}>
              <p className="break-all text-muted-foreground">{a.url}</p>
              <p>{a.action}</p>
              <p className="text-muted-foreground">{a.evidence}</p>
            </li>
          ))}
        </ul>
      )}
      {evidence.changes.length > 0 && (
        <ul className="space-y-2">
          {evidence.changes.map((c) => (
            <li key={c.url + c.text}>
              <p className="break-all">{c.url}</p>
              <p>
                {t("change", {
                  previous: day(c.previousDay),
                  current: day(c.currentDay ?? evidence.checkedAt),
                })}{" "}
                {c.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SeoAuditDiscovery({ evidence }: { evidence: Evidence }) {
  const t = useSeoResultTranslations("App.Seo.discovery");
  return (
    <section className="space-y-2" lang="en">
      <h4 className="font-medium">{t("heading")}</h4>
      <p>
        {t(evidence.status, {
          count: evidence.sitemaps.length,
          date: day(evidence.checkedAt),
        })}
      </p>
      {evidence.sitemaps.length > 0 && (
        <details>
          <SeoFoldSummary>{t("files")}</SeoFoldSummary>
          <ul className="space-y-2">
            {evidence.sitemaps.map((s) => (
              <li key={s.path}>
                <p className="break-all">{s.path}</p>
                {s.pending && <p>{t("pending")}</p>}
                <p>
                  {t("counts", {
                    errors: s.errors ?? "?",
                    warnings: s.warnings ?? "?",
                  })}
                </p>
                {s.webUrls !== null && (
                  <p>{t("webUrls", { count: s.webUrls })}</p>
                )}
                {s.submittedAt && (
                  <p>{t("submitted", { date: day(s.submittedAt) })}</p>
                )}
                {s.downloadedAt && (
                  <p>{t("read", { date: day(s.downloadedAt) })}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <SeoFoldSummary>
          {t("inspections", { count: evidence.inspections.length })}
        </SeoFoldSummary>
        <ul className="space-y-2">
          {evidence.inspections.map((p) => (
            <li key={p.page}>
              <p className="break-all">{p.page}</p>
              <p>{p.reason ?? p.verdict}</p>
              {p.canonical && (
                <p className="break-all">
                  {t("canonical", { url: p.canonical })}
                </p>
              )}
              {p.reportedSitemaps?.length ? (
                <div>
                  {t("reportedSitemaps")}
                  <ul>
                    {p.reportedSitemaps.map((url) => (
                      <li className="break-all" key={url}>
                        {url}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {p.referringPages?.length ? (
                <div>
                  {t("referringPages")}
                  <ul>
                    {p.referringPages.map((url) => (
                      <li className="break-all" key={url}>
                        {url}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {p.crawledAt && (
                <p>{t("crawl", { date: p.crawledAt.slice(0, 10) })}</p>
              )}
            </li>
          ))}
        </ul>
      </details>
      <SeoDiscoveryActions evidence={evidence} />
    </section>
  );
}

export function currentDiscoveryResult(
  workspace: ProjectSeoWorkspace,
  filterPages = false,
) {
  const selected = new Set(workspace.scope.pageIds);
  const urls = new Set(
    workspace.pages.filter((p) => selected.has(p.id)).map((p) => p.url),
  );
  const latest = workspace.observations
    .filter(
      (o) =>
        o.kind === "audit_full" &&
        o.sourceTaskId &&
        o.pageIds.length &&
        o.pageIds.every((id) => selected.has(id)),
    )
    .sort(
      (a, b) =>
        new Date(b.observedAt).valueOf() - new Date(a.observedAt).valueOf(),
    )[0];
  const result =
    latest &&
    workspace.auditSearchConsole?.find(
      (row) =>
        row.taskId === latest.sourceTaskId &&
        row.pageUrls.every((url) => urls.has(url)),
    );
  if (!filterPages || !result?.pageDiscovery) return result;
  return {
    ...result,
    pageDiscovery: {
      ...result.pageDiscovery,
      pages: result.pageDiscovery.pages.filter((page) =>
        urls.has(page.pageUrl),
      ),
    },
  };
}

export function SeoCurrentDiscoveryActions({
  workspace,
  result,
}: {
  workspace: ProjectSeoWorkspace;
  result: ReturnType<typeof currentDiscoveryResult>;
}) {
  return (
    <>
      {result && <SeoPropertyPageDiscovery report={result} actionsOnly />}
      {result && (
        <SeoConsoleExportActions
          owner={seoWorkspaceOwner(workspace)}
          taskId={result.taskId}
        />
      )}
    </>
  );
}
