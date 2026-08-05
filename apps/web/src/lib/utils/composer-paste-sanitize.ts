/**
 * Composer paste/typing helpers.
 * - Plain-text extraction from clipboard HTML (line-break aware)
 * - Strip forced text colors left in contentEditable (dark-mode composers
 *   inherit theme foreground; retained execCommand colors paint near-black)
 */

const COLOR_STYLE_PROPERTIES = [
  "color",
  "background-color",
  "background",
  "-webkit-text-fill-color",
  "caret-color",
] as const;

/** Block tags that should introduce a newline when extracting plain text. */
const PLAIN_TEXT_BLOCK_SELECTOR =
  "p, div, li, blockquote, pre, h1, h2, h3, h4, h5, h6, tr, table, ul, ol";

function removeColorDeclarations(styleValue: string): string {
  const declarations = styleValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  const kept = declarations.filter((declaration) => {
    const property = declaration.split(":")[0]?.trim().toLowerCase();
    if (!property) return false;
    return !COLOR_STYLE_PROPERTIES.includes(
      property as (typeof COLOR_STYLE_PROPERTIES)[number],
    );
  });

  return kept.join("; ");
}

function stripColorStylesFromElement(element: Element): boolean {
  let changed = false;

  if (element instanceof HTMLElement && element.hasAttribute("style")) {
    const next = removeColorDeclarations(element.getAttribute("style") ?? "");
    if (next) {
      if (next !== element.getAttribute("style")) {
        element.setAttribute("style", next);
        changed = true;
      }
    } else {
      element.removeAttribute("style");
      changed = true;
    }
  }

  if (element.hasAttribute("color")) {
    element.removeAttribute("color");
    changed = true;
  }
  if (element.hasAttribute("bgcolor")) {
    element.removeAttribute("bgcolor");
    changed = true;
  }

  return changed;
}

/**
 * Extract visible text from HTML without regex tag stripping (incomplete
 * multi-character sanitization). Prefer clipboard `text/plain` when available.
 * Preserves line breaks from `<br>` and common block tags.
 */
export function composerPastedHtmlToPlainText(html: string): string {
  if (!html) return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  for (const br of Array.from(body.querySelectorAll("br"))) {
    br.replaceWith(doc.createTextNode("\n"));
  }
  for (const block of Array.from(
    body.querySelectorAll(PLAIN_TEXT_BLOCK_SELECTOR),
  )) {
    block.appendChild(doc.createTextNode("\n"));
  }

  return (body.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Strip color styles already in the contentEditable DOM (paste leftovers or
 * retained typing style). Returns whether the DOM changed.
 */
export function stripComposerInlineTextColors(root: HTMLElement): boolean {
  let changed = false;
  if (stripColorStylesFromElement(root)) {
    changed = true;
  }
  for (const element of root.querySelectorAll("[style], [color], [bgcolor]")) {
    if (stripColorStylesFromElement(element)) {
      changed = true;
    }
  }
  return changed;
}
