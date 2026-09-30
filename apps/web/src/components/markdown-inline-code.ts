interface MarkdownLikeNode {
  type: string;
  value?: string;
  children?: MarkdownLikeNode[];
}

const SANITIZED_ENTITY_REGEX = /&(?:amp|lt);/g;

/**
 * `sanitizeMarkdown` runs over the markdown source, and sanitize-html writes
 * text `&` as `&amp;` and `<` as `&lt;`. Markdown reads those back in prose but
 * prints a code span as written, so `a && b` showed as `a &amp;&amp; b`.
 *
 * The undo runs on the parsed tree, not on the string. A code span here is one
 * the parser found, and its value goes out as text that nothing parses again.
 * Undoing `&lt;` in the string would trust a guess at where a span is, and a
 * wrong guess hands `<img onerror>` to rehype-raw: `` <p>`&lt;img>`</p> `` is
 * an HTML block, not a code span.
 *
 * `&gt;` is already undone in `sanitizeMarkdown`. A single pass keeps `&amp;lt;`
 * from turning into `<`.
 */
export function remarkRestoreInlineCodeEntities() {
  return (tree: MarkdownLikeNode) => {
    restoreInlineCodeEntities(tree);
  };
}

function restoreInlineCodeEntities(node: MarkdownLikeNode) {
  if (node.type === "inlineCode") {
    node.value = node.value?.replace(SANITIZED_ENTITY_REGEX, (entity) =>
      entity === "&lt;" ? "<" : "&",
    );
    return;
  }
  node.children?.forEach(restoreInlineCodeEntities);
}
