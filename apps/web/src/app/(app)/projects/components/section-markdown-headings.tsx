import type { Components } from "react-markdown";

/**
 * Markdown headings for a document shown inside a page section.
 *
 * The section's own heading is an h2, so a `## Goals` in the document belongs
 * under it: every level moves down to start at h3. The prose styles already
 * size h3 and below at the small end of the scale, so the document's headings
 * no longer outrank the section they sit in.
 */
export const SECTION_MARKDOWN_HEADINGS: Components = {
  h1: ({ node: _node, ...props }) => <h3 {...props} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} />,
  h4: ({ node: _node, ...props }) => <h5 {...props} />,
  h5: ({ node: _node, ...props }) => <h6 {...props} />,
  h6: ({ node: _node, ...props }) => <h6 {...props} />,
};
