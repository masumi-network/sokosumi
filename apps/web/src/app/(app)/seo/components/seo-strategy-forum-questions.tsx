import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { isValidHttpUrl } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SeoPageLink, SeoShowMore, seoFoldCount } from "./seo-shared";

const INITIAL_QUESTION_GROUPS = 3;

function sourceLink(value: string | undefined) {
  if (!value || !isValidHttpUrl(value)) return undefined;
  const url = new URL(value);
  return url.username || url.password ? undefined : url.href;
}

export function SeoStrategyForumQuestions({
  workspace,
  selectedPageId,
}: {
  workspace: ProjectSeoWorkspace;
  selectedPageId: string | null;
}) {
  const t = useTranslations("App.Seo.strategy.forumQuestions");
  const [expanded, setExpanded] = useState(false);
  const urls = new Set(
    workspace.pages
      .filter(
        (page) =>
          workspace.scope.pageIds.includes(page.id) &&
          (!selectedPageId || selectedPageId === page.id),
      )
      .map((page) => page.url),
  );
  const groups = (workspace.strategy?.groups ?? []).filter(
    (group) =>
      group.pageUrl && urls.has(group.pageUrl) && group.forumQuestions?.length,
  );
  if (!groups.length) return null;
  const visible = seoFoldCount(groups.length, INITIAL_QUESTION_GROUPS);
  return (
    <section aria-label={t("title")} className="space-y-1.5 border-t pt-2">
      <h3 className="font-medium">{t("title")}</h3>
      <ul className="space-y-2">
        {groups.slice(0, expanded ? groups.length : visible).map((group) => (
          <li key={JSON.stringify([group.pageUrl, group.lead])}>
            <p className="text-muted-foreground break-words">
              {t("keyword", { keyword: group.lead })}
            </p>
            <ul className="list-disc space-y-1 ps-5">
              {group.forumQuestions?.map((question) => {
                const url = sourceLink(question.url);
                return (
                  <li key={JSON.stringify([question.title, question.url])}>
                    {url ? (
                      <SeoPageLink url={url} label={question.title} />
                    ) : (
                      <span className="break-words">{question.title}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {visible < groups.length && (
        <SeoShowMore
          more={t("more", { count: groups.length - visible })}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      )}
    </section>
  );
}
