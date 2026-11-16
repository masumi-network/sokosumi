"use client";

import type { ProjectSeoStrategy } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import {
  seoFeatureSearches,
  seoReachKey,
  seoRivalLists,
} from "./seo-keyword-reach-model";
import { SeoFoldSummary } from "./seo-shared";

type Strategy = NonNullable<ProjectSeoStrategy>;
type RivalHost = NonNullable<Strategy["rivalKeywords"]>[number];

/**
 * The keyword reach sections of the site audit (SEO bot ticket 76), as closed lines inside the keyword strategy: the
 * reach of each feature's best search, the keywords of the competing products, and article ideas. They are context
 * for content: the strategy verdict does not read them. Keywords, features and hosts are third-party text, so they
 * show as plain text in the site's language.
 */
export function SeoKeywordReach({ strategy }: { strategy: Strategy | null }) {
  if (!strategy) return null;
  const { featureReach, rivalKeywords, articleIdeas } = strategy;
  return (
    <>
      {featureReach?.length ? <FeatureReach rows={featureReach} /> : null}
      {rivalKeywords?.length ? <RivalKeywords hosts={rivalKeywords} /> : null}
      {articleIdeas?.length ? <ArticleIdeas ideas={articleIdeas} /> : null}
    </>
  );
}

/** "50 searches a month · Forum in the results": the numbers and the reach of one keyword. */
function useReachLine() {
  const t = useTranslations("App.Seo.keywordReach");
  return (searches: string | null, reach: string, position: number | null) => {
    const key = seoReachKey(reach);
    return [
      searches,
      key ? t(`reach.${key}`) : reach,
      position === null ? null : t("position", { position }),
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
  };
}

function Fold({
  title,
  help,
  testId,
  children,
}: {
  title: string;
  help: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <details className="px-2 text-sm" data-testid={testId}>
      <SeoFoldSummary className="py-2.5">
        <span className="min-w-0 break-words">{title}</span>
      </SeoFoldSummary>
      <div className="max-w-prose space-y-2 pb-2">
        <p className="text-muted-foreground">{help}</p>
        {children}
      </div>
    </details>
  );
}

function FeatureReach({
  rows,
}: {
  rows: NonNullable<Strategy["featureReach"]>;
}) {
  const t = useTranslations("App.Seo.keywordReach");
  const reachLine = useReachLine();
  return (
    <Fold
      title={t("features.title")}
      help={t("features.help")}
      testId="seo-feature-reach"
    >
      <ul role="list" className="space-y-2">
        {rows.map((row) => {
          const { searches, suggested } = seoFeatureSearches(row);
          return (
            <li key={`${row.feature}:${row.keyword}`} className="break-words">
              <span dir="auto">{row.keyword}</span>
              <span className="text-muted-foreground"> · </span>
              <span className="text-muted-foreground" dir="auto">
                {row.feature}
              </span>
              <span className="text-muted-foreground block tabular-nums">
                {reachLine(
                  suggested === null
                    ? t("searches", { count: searches })
                    : t("searchesBoth", { count: searches, suggested }),
                  row.reach,
                  row.position,
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}

function RivalKeywords({ hosts }: { hosts: RivalHost[] }) {
  const t = useTranslations("App.Seo.keywordReach");
  return (
    <Fold
      title={t("rivals.title")}
      help={t("rivals.help")}
      testId="seo-rival-keywords"
    >
      {hosts.map((host, index) => (
        <RivalHostRows key={`${index}:${host.host}`} host={host} />
      ))}
    </Fold>
  );
}

function RivalHostRows({ host }: { host: RivalHost }) {
  const t = useTranslations("App.Seo.keywordReach");
  const format = useFormatter();
  const lists = seoRivalLists(host);
  // A row is a topic row when it holds any of the words, so the list reads "a, b or c".
  const words = format.list(
    host.topicWords.map((word) => t("rivals.word", { word })),
    { type: "disjunction" },
  );
  return (
    <section className="space-y-1.5 pt-1">
      <h3 className="font-medium break-all">{host.host}</h3>
      {host.topicWords.length ? (
        <p className="text-muted-foreground">
          {t(lists.topic.length ? "rivals.topic" : "rivals.noTopic", { words })}
        </p>
      ) : null}
      <RivalRows rows={lists.topic} more={lists.topicMore} />
      {lists.other.length ? (
        <details>
          <SeoFoldSummary className="text-muted-foreground py-1">
            <span className="min-w-0 break-words">
              {t(
                host.topicWords.length === 1
                  ? "rivals.otherOne"
                  : "rivals.other",
                { count: lists.other.length + lists.otherMore },
              )}
            </span>
          </SeoFoldSummary>
          <RivalRows rows={lists.other} more={lists.otherMore} />
        </details>
      ) : null}
    </section>
  );
}

function RivalRows({ rows, more }: { rows: RivalHost["rows"]; more: number }) {
  const t = useTranslations("App.Seo.keywordReach");
  const format = useFormatter();
  if (!rows.length) return null;
  return (
    <ul role="list" className="space-y-1">
      {rows.map((row, index) => (
        <li
          // Two rows can share a keyword when both links failed the import's check.
          key={`${index}:${row.keyword}`}
          className="flex flex-wrap justify-between gap-x-3 break-words"
        >
          <span dir="auto" className="min-w-0">
            {row.keyword}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {[
              row.volume === null ? null : t("searches", { count: row.volume }),
              row.position === null
                ? null
                : t("position", { position: row.position }),
            ]
              .filter((part): part is string => part !== null)
              .join(" · ")}
          </span>
        </li>
      ))}
      {more ? (
        <li className="text-muted-foreground">
          {t("rivals.more", { count: format.number(more) })}
        </li>
      ) : null}
    </ul>
  );
}

function ArticleIdeas({
  ideas,
}: {
  ideas: NonNullable<Strategy["articleIdeas"]>;
}) {
  const t = useTranslations("App.Seo.keywordReach");
  const reachLine = useReachLine();
  return (
    <Fold
      title={t("ideas.title")}
      help={t("ideas.help")}
      testId="seo-article-ideas"
    >
      <ul role="list" className="space-y-2">
        {ideas.map((idea) => (
          <li key={idea.topic} className="break-words">
            <span dir="auto">{idea.topic}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-muted-foreground" dir="auto">
              {idea.feature}
            </span>
            <span className="text-muted-foreground block tabular-nums">
              {idea.keyword ? (
                <>
                  <span dir="auto">{idea.keyword}</span>
                  {": "}
                </>
              ) : null}
              {reachLine(
                idea.demand === null
                  ? null
                  : t("searches", { count: idea.demand }),
                idea.reach,
                idea.position,
              )}
            </span>
          </li>
        ))}
      </ul>
    </Fold>
  );
}
