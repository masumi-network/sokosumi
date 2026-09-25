export const MAX_MERMAID_LENGTH = 4000;
export const MAX_MERMAID_EDGES = 50;

/** Deliberately support text-only flowcharts, not Mermaid's active extensions. */
export function mermaidSourceError(
  source: string,
): "unsupported" | "tooLarge" | null {
  if (
    source.length > MAX_MERMAID_LENGTH ||
    (source.match(/[\p{L}\p{N}_]+/gu) ?? []).length > 200 ||
    source.split(/\r?\n/).length > 100
  )
    return "tooLarge";
  if (!/^\s*(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/.test(source))
    return "unsupported";
  // Block configuration, HTML/entities, CSS, URLs, icons/images, math and
  // click handlers BEFORE Mermaid touches a live measurement DOM.
  if (
    /[<&#\\`@:%]/.test(source) ||
    /\b(click|style|classDef|class|linkStyle|href|callback|call|url|image|icon)\b/i.test(
      source,
    ) ||
    /\$\$|\/\//.test(source)
  )
    return "unsupported";
  if ((source.match(/-->|---|==>|-\.->/g) ?? []).length > MAX_MERMAID_EDGES)
    return "tooLarge";
  return null;
}
