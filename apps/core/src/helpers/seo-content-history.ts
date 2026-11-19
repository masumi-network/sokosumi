import { z } from "@hono/zod-openapi";
import {
  publicExplorationText,
  publicExplorationUrl,
} from "./project-seo-exploration-privacy";
import { reportObject } from "./project-seo-public-report";

const section = z.string().trim().min(2).max(96).refine(publicExplorationText);
const recentDays = 180;
const dayMs = 86_400_000;
const volatileOrPrivateKey =
  /^(utm_.+|gclid|gad_source|gbraid|wbraid|srsltid|_gl|_ga|fbclid|igshid|msclkid|dclid|yclid|ttclid|twclid|mc_cid|mc_eid|_hsenc|_hsmi|phpsessid|jsessionid|session[_-]?id|(?:access|refresh|id)[_-]?token|api[_-]?key|token|secret|client[_-]?secret|password|authorization|cookie|user[_-]?id|client[_-]?id|user_pseudo_id|email)$/iu;
function publicArticleUrl(raw: string): boolean {
  const url = URL.parse(raw);
  if (!url || url.href !== raw || url.hash) return false;
  if (
    [...url.searchParams].some(
      ([k, v]) =>
        volatileOrPrivateKey.test(k) ||
        !publicExplorationText(k) ||
        !publicExplorationText(v),
    )
  )
    return false;
  url.search = "";
  return publicExplorationUrl(url.href);
}
const article = z.object({
  url: z.httpUrl().refine(publicArticleUrl),
  publishedOn: z.iso.date(),
  revisedOn: z.iso.date().optional(),
  record: z.hash("sha256"),
});
export const seoArticleDates = article.extend({ section: section.optional() });
export const seoTopicLaunch = z.object({
  topic: section,
  publishedFrom: z.iso.date(),
  publishedThrough: z.iso.date(),
  pages: z.array(article).min(2).max(10),
  earlierArticle: article.optional(),
});
type Article = z.infer<typeof seoArticleDates>;
const key = (label: string) =>
  label.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");

export function articleDates(raw: unknown, url: string, capturedAt: string) {
  const item = reportObject(reportObject(raw)?.articleDates);
  if (!item) return;
  const parsed = seoArticleDates.safeParse({
    ...item,
    url: URL.parse(url)?.href,
  });
  if (!parsed.success) return;
  const { publishedOn, revisedOn } = parsed.data,
    day = capturedAt.slice(0, 10);
  if (
    publishedOn > day ||
    (revisedOn && (revisedOn < publishedOn || revisedOn > day))
  )
    return;
  return [parsed.data];
}

/** A site can supply public dates for an explicitly requested page or for a page selected from a named public source. */
export function publicSiteArticles(
  raw: unknown,
  pages: { articleDates?: Article[] }[],
) {
  const articles = pages.flatMap((p) => p.articleDates ?? []);
  const site = reportObject(raw),
    request = reportObject(site?.request),
    selection = reportObject(site?.selection);
  const urlKey = (value: unknown) =>
    typeof value === "string" ? URL.parse(value)?.href : undefined;
  const explicit = new Set([
    urlKey(request?.url),
    ...(Array.isArray(request?.pages)
      ? request.pages.map((p) => urlKey(reportObject(p)?.url))
      : []),
  ]);
  const sources = Array.isArray(selection?.pages)
    ? selection.pages.map((p) => reportObject(p))
    : [];
  const publicSources = new Set(["owner", "links", "labs", "sitemap"]);
  return articles.filter((a) => {
    const entries = sources.filter((p) => urlKey(p?.url) === a.url);
    if (
      entries.some(
        (p) => p?.source !== undefined && !publicSources.has(String(p.source)),
      )
    )
      return false;
    return (
      explicit.has(a.url) ||
      (entries.length === 1 && publicSources.has(String(entries[0]?.source)))
    );
  });
}

export function boundTopicLaunches(
  raw: unknown,
  articles: Article[],
  newestCapture: number,
) {
  const cutoff = newestCapture - recentDays * dayMs;
  const groups = reportObject(raw)?.topicLaunches;
  if (!Array.isArray(groups) || groups.length > 10) return;
  const seen = new Set<string>();
  const result = groups.flatMap((value) => {
    const parsed = seoTopicLaunch.safeParse(value);
    if (!parsed.success) return [];
    const group = parsed.data,
      label = key(group.topic);
    const rows = group.earlierArticle
      ? [...group.pages, group.earlierArticle]
      : group.pages;
    const origins = new Set(rows.map((row) => new URL(row.url).origin));
    const dates = group.pages.map((row) => row.publishedOn).sort();
    if (
      Date.parse(group.publishedFrom) < cutoff ||
      Date.parse(group.publishedThrough) > newestCapture ||
      (group.earlierArticle &&
        Date.parse(group.earlierArticle.publishedOn) >= cutoff) ||
      seen.has(label) ||
      origins.size !== 1 ||
      new Set(rows.map((row) => row.url)).size !== rows.length ||
      dates[0] !== group.publishedFrom ||
      dates.at(-1) !== group.publishedThrough ||
      (group.earlierArticle &&
        group.earlierArticle.publishedOn >= group.publishedFrom) ||
      rows.some((row) => {
        const matches = articles.filter((a) => a.url === row.url);
        const source = matches[0];
        return (
          matches.length !== 1 ||
          !source.section ||
          key(source.section) !== label ||
          source.record !== row.record ||
          source.publishedOn !== row.publishedOn ||
          source.revisedOn !== row.revisedOn
        );
      })
    )
      return [];
    seen.add(label);
    return [group];
  });
  return result.length ? result : undefined;
}

/** Keep the newest observation for each selected page. Never show an unselected URL in a cohort. */
export class SeoContentHistory {
  private readonly seen = new Set<string>();
  readonly articles: Article[] = [];
  readonly groups: z.infer<typeof seoTopicLaunch>[] = [];
  append(
    data: {
      pageUrls: string[];
      articleDates?: Article[];
      topicLaunches?: z.infer<typeof seoTopicLaunch>[];
    },
    selected: Set<string>,
  ) {
    const available = new Set(
      data.pageUrls
        .map((url) => new URL(url).href)
        .filter((url) => selected.has(url) && !this.seen.has(url)),
    );
    for (const a of data.articleDates ?? [])
      if (available.has(a.url)) this.articles.push(a);
    for (const group of data.topicLaunches ?? []) {
      const pages = group.pages.filter((p) => available.has(p.url));
      if (pages.length < 2) continue;
      const dates = pages.map((p) => p.publishedOn).sort();
      const { earlierArticle, ...base } = group;
      this.groups.push({
        ...base,
        pages,
        publishedFrom: dates[0],
        publishedThrough: dates[dates.length - 1],
        ...(earlierArticle &&
          available.has(earlierArticle.url) && { earlierArticle }),
      });
    }
    for (const url of available) this.seen.add(url);
  }
}
