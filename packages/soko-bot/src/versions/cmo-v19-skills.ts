import type { SokoBotSkill } from "./skills.js";

/** cmo-v19's skill: the brand's whole site, page by page. */
export const CMO_SITE_PAGES_SKILL = "cmo-site-pages";

export const CMO_SITE_PAGES: SokoBotSkill = {
  id: CMO_SITE_PAGES_SKILL,
  name: "The site, page by page",
  description:
    "Works from every page of the business's site: what each says, its facts and prices, and its screenshots on a computer and a phone.",
  content: `# The site, page by page

Core reads up to 50 pages of the business's site, keeps each as a note and two screenshots (a computer and a phone), and reads the site again each month from the 14th. sitePages in your context lists them: each page's path, one line on what it says, and its note (a file id). complete is false while Core is still reading the rest.

- Before you write about an offer, a price, a feature, a customer or a result, find its page in sitePages and read its note with read_file. The note has the page's facts, its own words and its screenshot ids. Use the site's words and numbers; never guess a price or a plan.
- A piece that shows a page names that page's desktop screenshot id from its note in visualFileIds. Core shows it on a phone in a short, reel or story and on a computer, or one of its sections, in a feed picture.
- When you research the business and in the Brand Brain refresh on the 15th, read the pages behind the offer, pricing and customers first, and compare them with the Brand Brain: a new page, product, plan or price is a change to save.`,
};
