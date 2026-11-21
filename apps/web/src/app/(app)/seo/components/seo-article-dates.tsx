import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoResultFormat } from "@/i18n/seo-result-messages";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { seoArticleHistory } from "./seo-article-dates-model";
import {
  SeoPageLink,
  SeoSection,
  seoPageLabel,
  seoSiteUrl,
} from "./seo-shared";

const day = (value: Date) =>
  seoResultFormat.dateTime(new Date(value), {
    dateStyle: "medium",
    timeZone: "UTC",
  });

export function SeoArticleDates({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useSeoResultTranslations("App.Seo.actions");
  const { groups, singles, ageAtAudit } = seoArticleHistory(workspace);
  if (!groups.size && !singles.length) return null;
  const link = (url: string) => (
    <SeoPageLink
      url={url}
      label={seoPageLabel(workspace, url)}
      site={seoSiteUrl(workspace)}
      quiet
    />
  );
  const article = (
    page: NonNullable<ProjectSeoWorkspace["articleDates"]>[number],
  ) => {
    const age = ageAtAudit(page);
    return (
      <>
        {link(page.url)} · {t("publishedOn", { date: day(page.publishedOn) })}
        {page.revisedOn && (
          <> · {t("revisedOn", { date: day(page.revisedOn) })}</>
        )}
        {age && (
          <> · {t("publicationAge", { days: age.days, date: day(age.date) })}</>
        )}
      </>
    );
  };
  return (
    <SeoSection lang="en" title={t("articleDatesTitle")}>
      <div lang="en" className="space-y-4 px-2 text-sm">
        <p className="text-muted-foreground">{t("publicationSource")}</p>
        {[...groups].map(([key, cohorts]) => (
          <section key={key} className="space-y-2">
            <h3 className="font-medium">
              <bdi lang="">{cohorts[0].topic}</bdi>
            </h3>
            {cohorts.map((group) => {
              const earlier = group.earlierArticle;
              const queries = workspace.privateTopicQueries?.filter(
                (row) =>
                  row.topic === group.topic &&
                  row.pages.every((url) =>
                    group.pages.some((p) => p.url === url),
                  ),
              );
              return (
                <div key={group.pages[0].url} className="space-y-1">
                  <p>
                    {t("articleCohort", {
                      count: group.pages.length,
                      from: day(group.publishedFrom),
                      through: day(group.publishedThrough),
                    })}
                  </p>
                  <p className="text-muted-foreground">
                    {t(
                      group.basis === "headline_phrase"
                        ? "topicPhrase"
                        : "topicSection",
                    )}
                  </p>
                  {queries?.map((row) => (
                    <p key={row.observationId}>
                      {t("topicQuery", {
                        query: row.query,
                        count: row.pages.length,
                        from: day(row.from),
                        to: day(row.to),
                      })}
                    </p>
                  ))}
                  {earlier ? (
                    <p>
                      {t(
                        group.basis === "headline_phrase"
                          ? "earlierHeadline"
                          : "earlierArticle",
                        { date: day(earlier.publishedOn) },
                      )}{" "}
                      {link(earlier.url)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      {t("earlierUnseen")}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {group.pages.map((page) => (
                      <li key={page.url}>{article(page)}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        ))}
        {singles.map((p) => (
          <p key={p.url}>{article(p)}</p>
        ))}
      </div>
    </SeoSection>
  );
}
