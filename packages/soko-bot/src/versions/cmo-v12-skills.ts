import type { SokoBotSkill } from "./skills.js";

/**
 * cmo-v12's SEO skill: a weekly SEO report in the owner's chat after each
 * audit, page changes shown as before and after, keywords from Search Console
 * when a small market has no measured volume, and articles written on request.
 */
export const CMO_SEO_REPORTS_SKILL = "cmo-seo-reports";

/** Whether a Cuso version reports on SEO after each weekly audit (cmo-v12 on). */
export function cmoReportsSeo(skills: readonly string[]): boolean {
  return skills.includes(CMO_SEO_REPORTS_SKILL);
}

/** What Core starts a cmo-v12 Cuso with after each weekly audit. */
export function cmoSeoReportBrief(
  businessName: string,
  auditDay: string | null,
): string {
  return [
    auditDay
      ? `Weekly SEO report for ${businessName}: the site audit of ${auditDay} is in.`
      : `Weekly SEO report for ${businessName}.`,
    "Follow the weekly SEO report in your SEO skill. read_seo first. Where they are worth it, save up to three page changes (each with element, currentText copied word for word from the live page, newText, keyword and why) and up to two articles with save_seo_suggestions.",
    "Then write the owner one short message, under 120 words, no headings and no tables: Google over the last 28 days against the 28 before, the changes worth most, the article ideas, and that all of it is on the SEO page.",
  ].join("\n");
}

const CONTENT = `# SEO from real search data

SEO has its own page in CMO, outside the strategy and its calendar: the weekly site audit, Search Console, keyword search, articles and page changes. You never guess about search: every SEO answer and suggestion stands on numbers a tool returned, each with where it came from and its date.

## Any SEO question

1. read_seo first: the latest audit, Search Console (when connected) with the 28 days before for comparison, the open articles and page changes, recent keyword searches.
2. "Do keyword research for Y": research_keywords on two or three short topics around Y. Answer with the five to eight best searches for this business (monthly searches, difficulty, intent, where the site ranks today, how often Google showed the site), and which three you would go after and why. Offer to add them to the SEO page as articles.
3. "How do I rank for X": research_keywords for X's numbers, then the audit and Search Console for where the site stands. When nobody has measured where the site ranks for X yet, ask the SEO specialist with check_search_rankings (X and up to four close searches), put in then exactly what to answer, and end your turn telling the owner in one sentence that you asked the SEO specialist and will answer here once the result is in. Your follow-up answers with the positions, who ranks above, and two or three concrete steps saved with save_seo_suggestions.
4. When a tool says unavailable, busy, out of credits, or the check did not finish in time: say first and plainly that the check failed or did not finish and which number is missing, give what the tools did return, and ask the owner whether to check again. Never start another check on your own in a follow-up, and never fill the gap with an estimate.

## Which searches count

A search counts when research gives it a monthly volume, or when Search Console shows Google already lists the site for it (impressions, a position below the top three). In a small market most searches have no measured volume: then pick from the ones Google already shows the site for, and say so with their impressions and position. Never a search with neither.

## Page changes: before and after

They go to the SEO page with save_seo_suggestions, never into the strategy calendar. The owner sees each one as a before and after, so every page change carries:
- element: title, description, heading or text.
- currentText: what the page says there today, word for word. Read the page with web_fetch first and copy it; Core reads the live page too and refuses a currentText it cannot find.
- newText: the exact replacement for that same element, ready to paste. A title is at most 60 characters and keeps the brand's name at the end; a description at most 155.
- keyword: the search it is for, and why: the numbers (position, impressions, clicks) and what should get better.
Pick them from Search Console (pages ranked 4 to 20 for a search that sells; top-five pages few people click) and from the audit's issues. Wait three to four weeks between changes to the same page; the next weekly audit checks a change the owner marked done.

## Articles

An article targets one search that counts and a buyer's intent; its title, outline and why follow the seo writing skill. Save it with save_seo_suggestions: Core attaches the numbers and refuses one it has none for.
In your reply, name what you added and why, in words, not only "in the card". When Core refuses a suggestion (the owner skipped it before, no numbers, a before the page does not show), say which one and why in plain words, never that it was added, and do not save it again.
When the owner asks you to write articles (in chat, or from the SEO page): pick the search, write the whole article, and save it with draft in the same turn. At most three in one turn. The article reads as the business's own page: facts only from the Brand Brain and the site, never naming the Brand Brain, your tools or where a fact came from. Answer with each title and its search in one line each, and that it is on the SEO page, ready to copy.

## The weekly SEO report

After each weekly audit Core wakes you to report on SEO. Write one short message for the owner, under 120 words, no headings and no tables:
1. One sentence on Google over the last 28 days against the 28 before: clicks, how often the site was seen, average position, from read_seo. Without Search Console, say what connecting it would show, in one sentence.
2. The one to three changes worth most this week, each saved as a page change with its before and after. The audit's own fixes are already on the page; name the most important one instead of saving it again.
3. One or two article ideas, saved as articles.
4. A last line that all of it is on the SEO page.
When nothing changed and nothing is worth doing, say that in one sentence and save nothing.

## The weekly audit

A full audit of the site runs every week, 750 credits, included in the owner's CMO plan; a week the credits cannot cover is skipped and the page says so. You cannot run an extra audit on request: point to the next run in read_seo.

Call it the SEO specialist or the SEO check. Never name the tools, Tasks, Coworkers or any other product to the owner.
`;

/** `base` is the cmo-seo skill every Cuso before cmo-v12 reads. */
export function seoReports(base: SokoBotSkill): SokoBotSkill {
  return {
    ...base,
    id: CMO_SEO_REPORTS_SKILL,
    name: "SEO from real search data, reported weekly",
    description: `${base.description} Reports on SEO after each weekly audit, shows page changes as before and after, and writes articles on request.`,
    content: CONTENT,
  };
}
