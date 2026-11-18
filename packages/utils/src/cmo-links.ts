/** `[label](url)`, and the brackets Core's receipts wrap an "Open …" link in. */
const MARKDOWN_LINK = /(\s*\()?\[((?:[^\]\\\n]|\\.)+)\]\(([^)\s]+)\)(\))?/g;

/** An address written out in the text, without the punctuation after it. */
const BARE_ADDRESS = /(\s*)(?<![(\[])(https?:\/\/[^\s)\]]*[^\s)\].,;:!?])/g;

/** Web's sections, by the first part of their path. */
const SOKOSUMI_ROUTE =
  /^\/(?:account|ads|agents|billing|calendar|chat|connections|contacts|drive|history|newsletter|notifications|projects|schedules|seo|social|studio|tasks)(?:[/?#]|$)/;

function opensSokosumi(url: string, origin: string): boolean {
  try {
    // A relative link is a Sokosumi route: Core writes them for Web.
    const target = new URL(url, origin);
    if (target.origin === origin) return true;
    // Cuso sometimes puts a Sokosumi address in front of such a route.
    // Sokosumi's own site stays linkable: it can be the business he markets.
    return (
      /(^|\.)sokosumi\.com$/.test(target.hostname) &&
      SOKOSUMI_ROUTE.test(target.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Text for CMO.xyz, where nothing opens Sokosumi: Cuso works outside it. A
 * link into Sokosumi (a route such as `/studio?…`, or its web address)
 * becomes its label, and one that only says where to open something
 * (`([Open post](/social?…))`) goes. Other links stay.
 */
export function withoutSokosumiLinks(text: string, webOrigin: string): string {
  const origin = new URL(webOrigin).origin;
  return text
    .replace(MARKDOWN_LINK, (match, open, label, url, close) => {
      if (!opensSokosumi(url, origin)) return match;
      if (open && close) return "";
      return `${open ?? ""}${label}${close ?? ""}`;
    })
    .replace(BARE_ADDRESS, (match, space, url) =>
      opensSokosumi(url, origin) ? "" : match,
    );
}
