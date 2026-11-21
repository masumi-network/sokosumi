"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { MARKDOWN_PROSE_CLASS } from "@/components/markdown";
import { cn } from "@/lib/utils";

const REMARK_PLUGINS = [remarkBreaks, remarkGfm];
/** Only an outside address becomes a link. An app path in model output could start an app action. */
const OUTSIDE_LINK = /^(https?:|mailto:)/i;
/** The scheme, "www." and a closing slash of a bare address: "https://www.site.app/" reads as "site.app". */
const ADDRESS_NOISE = /^https?:\/\/(www\.)?|\/$/gi;

/**
 * How a reply renders. Its headings sit below the chat's own heading. It loads
 * no media: the reply is model output over page content the agent read, so an
 * image address in it could make the reader's browser call an outside host.
 */
const COMPONENTS: Components = {
  h1: "h4",
  h2: "h4",
  h3: "h5",
  h4: "h6",
  h5: "h6",
  img: ({ alt }) => alt || null,
  a: ({ node: _node, href, children, ...props }) =>
    href && OUTSIDE_LINK.test(href) ? (
      <a
        {...props}
        href={href}
        className="wrap-anywhere"
        target="_blank"
        rel="noopener noreferrer"
      >
        {/* A bare address is long and alike on every line; the short form names the page. */}
        {children === href ? href.replace(ADDRESS_NOISE, "") : children}
      </a>
    ) : (
      children
    ),
  table: ({ node: _node, children, ...props }) => (
    <div className="app-scrollbar border-border my-3 overflow-x-auto rounded-md border">
      <table
        {...props}
        className="w-full min-w-full caption-bottom border-collapse text-sm"
      >
        {children}
      </table>
    </div>
  ),
  blockquote: ({ node: _node, children, ...props }) => (
    <blockquote
      {...props}
      className="border-input text-muted-foreground [&_p]:text-muted-foreground border-s-2 ps-3 not-italic [&_p]:before:content-none [&_p]:after:content-none"
    >
      {children}
    </blockquote>
  ),
  code: ({ node: _node, className, children, ...props }) => (
    <code
      {...props}
      className={cn(
        // A fenced block ends in a line break; inline code has none.
        !String(children).includes("\n") &&
          "bg-muted text-foreground rounded px-1 py-0.5 font-mono text-xs wrap-break-word before:content-none after:content-none",
        className,
      )}
    >
      {children}
    </code>
  ),
};

/**
 * An agent reply. The agent writes about HTML ("the <title> is too long"), so
 * this renderer reads no HTML: a tag in the reply shows as the text it is, in
 * prose and in code. The app's Markdown component removes such tags, and turns
 * "<3" and "8)" into emoji, which changes what the agent said.
 */
export const SeoChatReply = memo(function SeoChatReply({
  text,
}: {
  text: string;
}) {
  return (
    <div className={cn(MARKDOWN_PROSE_CLASS, "max-w-prose text-sm")}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
