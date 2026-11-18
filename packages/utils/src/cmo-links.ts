// Each pattern can only fail at the next bracket, so a run of brackets or
// spaces is read once, not once per character (CodeQL: polynomial regex).

/** `[label](url)`, and the brackets Core's receipts wrap an "Open …" link in. */
const MARKDOWN_LINK = /(\()?\[((?:[^[\]\\\n]|\\.)+)\]\(([^()[\]\s]+)\)(\))?/g;

/** An address written out in the text, without the punctuation after it. */
const BARE_ADDRESS = /(?<![(\[])https?:\/\/[^\s)\]]*[^\s)\].,;:!?]/g;

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
  const withoutLinks = rewrite(text, MARKDOWN_LINK, (match) => {
    const [whole, open, label, url, close] = match;
    if (!opensSokosumi(url ?? "", origin)) return whole;
    if (open && close) return null;
    return `${open ?? ""}${label}${close ?? ""}`;
  });
  return rewrite(withoutLinks, BARE_ADDRESS, ([url]) =>
    opensSokosumi(url, origin) ? null : url,
  );
}

/** Replaces each match; `null` drops it together with the spaces before it. */
function rewrite(
  text: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => string | null,
): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(last, match.index);
    const replacement = replace(match);
    out += replacement === null ? before.trimEnd() : before + replacement;
    last = match.index + match[0].length;
  }
  return out + text.slice(last);
}
