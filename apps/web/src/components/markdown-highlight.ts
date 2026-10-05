const MAX_QUERY_LENGTH = 256;
const MARK_CLASS_NAME = [
  "bg-primary-tertiary",
  "text-foreground",
  "rounded-sm",
  "px-0.5",
];

interface HastLikeNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastLikeNode[];
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function underline(text: string) {
  return Array.from(text, (char) => `${char}̲`).join("");
}

/**
 * Highlights the search term in the parsed tree, where a match can only be
 * display text. Matching the markdown source instead cut links at the term
 * and corrupted tags whose names or attributes contained it.
 *
 * A match is wrapped in `<mark>`; inside code it gets a combining underline,
 * so the syntax highlighter still sees one plain string.
 */
export function rehypeSearchTermHighlight(term: string | undefined) {
  const query = (term ?? "").trim();
  if (!query || query.length > MAX_QUERY_LENGTH) return;
  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");

  function highlight(node: HastLikeNode, inCode: boolean) {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text") {
        highlight(child, inCode || child.tagName === "code");
        return child;
      }
      // Odd entries are the matches, from the capture group.
      const parts = (child.value ?? "").split(regex);
      if (parts.length === 1) return child;
      if (inCode) {
        const value = parts
          .map((part, index) => (index % 2 ? underline(part) : part))
          .join("");
        return { ...child, value };
      }
      return parts.flatMap((part, index): HastLikeNode[] => {
        if (!part) return [];
        const text = { type: "text", value: part };
        if (index % 2 === 0) return [text];
        return [
          {
            type: "element",
            tagName: "mark",
            properties: { className: MARK_CLASS_NAME },
            children: [text],
          },
        ];
      });
    });
  }

  return (tree: HastLikeNode) => highlight(tree, false);
}
