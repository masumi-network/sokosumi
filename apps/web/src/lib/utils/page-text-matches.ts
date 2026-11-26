interface TextPart {
  node: Text;
  start: number;
}

/** Read visible inline text without inserting markup inside React-owned nodes. */
export function pageTextMatches(root: HTMLElement, text: string): Range[] {
  const needle = text.trim();
  if (!needle) return [];
  // Matching the original string preserves offsets for Unicode case-insensitive matches.
  const pattern = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  const matches: Range[] = [];
  let parts: TextPart[] = [];
  let run = "";

  function finishRun() {
    let index = 0;
    for (const match of run.matchAll(pattern)) {
      while (parts[index + 1] && parts[index + 1].start <= match.index) index++;
      const first = parts[index];
      const end = match.index + match[0].length;
      while (parts[index + 1] && parts[index + 1].start < end) index++;
      const last = parts[index];
      const range = document.createRange();
      range.setStart(first.node, match.index - first.start);
      range.setEnd(last.node, end - last.start);
      matches.push(range);
    }
    parts = [];
    run = "";
  }

  function visit(node: Node) {
    if (node instanceof Text) {
      if (node.length) {
        parts.push({ node, start: run.length });
        run += node.data;
      }
      return;
    }
    if (!(node instanceof Element)) return;
    if (
      node.matches(
        'script, style, svg, textarea, select, [hidden], [inert], [aria-hidden="true"], .sr-only, [role="dialog"], [role="alertdialog"], [role="menu"]',
      )
    )
      return;
    const { display, visibility } = getComputedStyle(node);
    if (display === "none" || visibility === "hidden") return;
    const separated =
      node.tagName === "BR" ||
      (display && !display.startsWith("inline") && display !== "contents");
    if (separated && parts.length) finishRun();
    if (node.tagName === "DETAILS" && !node.hasAttribute("open")) {
      const summary = node.querySelector(":scope > summary");
      if (summary) visit(summary);
    } else {
      node.childNodes.forEach(visit);
    }
    if (separated && parts.length) finishRun();
  }

  root.childNodes.forEach(visit);
  if (parts.length) finishRun();
  return matches;
}
