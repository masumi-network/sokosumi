/**
 * Strip paste/typing styles that force text color. Dark-mode composers inherit
 * theme foreground; inline `color` from light-mode clipboard HTML (or retained
 * execCommand typing style) paints near-black text on a dark card until remount.
 */

const COLOR_STYLE_PROPERTIES = [
  "color",
  "background-color",
  "background",
  "-webkit-text-fill-color",
  "caret-color",
] as const;

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

/** Remove color-forcing attributes from a pasted HTML fragment. */
export function sanitizeComposerPastedHtml(html: string): string {
  if (!html) return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode as Element | null;
  while (node) {
    stripColorStylesFromElement(node);
    node = walker.nextNode() as Element | null;
  }
  return doc.body.innerHTML;
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
