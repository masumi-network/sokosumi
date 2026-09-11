import { linkifyBareDomainsInMarkdown } from "@sokosumi/utils";
import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkBreaks from "remark-breaks";
import remarkEmoji from "remark-emoji";
import remarkGfm from "remark-gfm";

import { applyMarkdownHighlighting } from "@/components/markdown-highlight";
import { markdownHighlightThemeCss } from "@/components/markdown-highlight-theme";
import { rehypeMarkdownCodeHighlight } from "@/components/markdown-highlighter";
import { cn } from "@/lib/utils";
import { normalizeLooseInlineMarkdown } from "@/lib/utils/composer-markdown-dom";
import {
  isAudioUrl,
  isVideoUrl,
  stripForcedDownloadParam,
} from "@/lib/utils/file-preview";
import { sanitizeMarkdown } from "@/lib/utils/sanitizeMarkdown";

function isInternalAppPath(href: string | undefined): href is string {
  return Boolean(href?.startsWith("/") && !href.startsWith("//"));
}

function isSokosumiLink(href: string | undefined): boolean {
  if (!href || href.startsWith("#")) return true;
  if (isInternalAppPath(href)) return true;
  try {
    const url = new URL(href, "https://sokosumi.com");
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host.endsWith(".sokosumi.com") ||
      host === "sokosumi.com"
    );
  } catch {
    return false;
  }
}

function markdownCodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(markdownCodeText).join("");
  }
  return "";
}

function markdownCodeHasElements(children: ReactNode): boolean {
  if (Array.isArray(children)) {
    return children.some(
      (child) => typeof child === "object" && child !== null,
    );
  }
  return typeof children === "object" && children !== null;
}

function isMarkdownInlineCode(
  className: string | undefined,
  children: ReactNode,
): boolean {
  if (className?.includes("language-")) {
    return false;
  }
  if (markdownCodeHasElements(children)) {
    return false;
  }
  return !markdownCodeText(children).includes("\n");
}

interface MarkdownProps {
  children: string;
  className?: string | undefined;
  highlightTerm?: string | undefined;
  components?: Components;
}

export default function Markdown({
  children,
  className,
  highlightTerm,
  components: extraComponents,
}: MarkdownProps) {
  const defaultComponents: Components = useMemo(
    () => ({
      a: ({ href, children, className, node: _node, ...props }) => {
        const classNames = cn(
          "wrap-anywhere [overflow-wrap:anywhere]",
          className,
        );
        if (isInternalAppPath(href)) {
          return (
            <Link href={href} className={classNames} {...props}>
              {children}
            </Link>
          );
        }
        const sameTab = isSokosumiLink(href);
        return (
          <a
            href={href}
            {...props}
            className={classNames}
            {...(sameTab
              ? {}
              : { target: "_blank", rel: "noopener noreferrer" })}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt, ...props }) => {
        const srcString = typeof src === "string" ? src : undefined;
        if (srcString && isVideoUrl(srcString)) {
          const mediaSrc = stripForcedDownloadParam(srcString);
          return (
            <video
              src={mediaSrc}
              controls
              playsInline
              preload="metadata"
              className="h-auto w-full max-w-full rounded-lg"
              aria-label={alt || undefined}
            />
          );
        }
        if (srcString && isAudioUrl(srcString)) {
          const mediaSrc = stripForcedDownloadParam(srcString);
          return (
            <audio
              src={mediaSrc}
              controls
              preload="metadata"
              className="w-full max-w-full"
              aria-label={alt || undefined}
            />
          );
        }
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            className="h-auto max-w-full rounded-lg"
            {...props}
          />
        );
      },
      video: ({ children, src, autoPlay: _autoPlay, ...props }) => {
        const srcString =
          typeof src === "string" ? stripForcedDownloadParam(src) : src;
        return (
          <video
            {...props}
            src={srcString}
            className="h-auto w-full max-w-full rounded-lg"
            controls
            playsInline
            preload="metadata"
          >
            {children}
          </video>
        );
      },
      audio: ({ children, src, autoPlay: _autoPlay, ...props }) => {
        const srcString =
          typeof src === "string" ? stripForcedDownloadParam(src) : src;
        return (
          <audio
            {...props}
            src={srcString}
            className="w-full max-w-full"
            controls
            preload="metadata"
          >
            {children}
          </audio>
        );
      },
      table: ({ children, className, ...props }) => (
        <div className="border-border my-3 overflow-x-auto rounded-md border">
          <table
            {...props}
            className={cn(
              "w-full min-w-full caption-bottom border-collapse text-sm",
              className,
            )}
          >
            {children}
          </table>
        </div>
      ),
      code: ({ className, children, ...props }) => {
        if (isMarkdownInlineCode(className, children)) {
          return (
            <code
              {...props}
              className={cn(
                "bg-muted text-foreground rounded px-1 py-0.5 font-mono text-xs wrap-break-word",
                "before:content-none after:content-none",
                className,
              )}
            >
              {children}
            </code>
          );
        }

        return (
          <code {...props} className={className}>
            {children}
          </code>
        );
      },
    }),
    [],
  );

  const components = useMemo(
    () =>
      extraComponents
        ? { ...defaultComponents, ...extraComponents }
        : defaultComponents,
    [defaultComponents, extraComponents],
  );

  const baseTypographyClassName =
    "wrap-anywhere prose prose-sm prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-h4:text-sm prose-h5:text-sm prose-h6:text-sm prose-p:my-2 prose-p:leading-relaxed prose-p:text-foreground/80 prose-strong:font-bold prose-strong:text-foreground prose-em:italic prose-ul:my-2 prose-ul:list-disc prose-ul:ps-6 prose-ol:my-2 prose-ol:list-decimal prose-ol:ps-6 prose-li:my-1 prose-li:ps-1 prose-li:marker:text-muted-foreground prose-li:text-foreground/80 prose-a:text-primary prose-a:font-medium prose-a:underline prose-a:underline-offset-4 prose-a:decoration-primary/40 hover:prose-a:decoration-primary prose-pre:my-3 prose-pre:rounded-md prose-pre:border prose-pre:border-border prose-pre:bg-muted/40 prose-pre:px-4 prose-pre:py-3 prose-pre:text-sm prose-pre:leading-6 prose-pre:font-normal prose-pre:[tab-size:2] prose-pre:[text-wrap:pretty] prose-blockquote:my-3 prose-hr:my-4 prose-hr:border-border prose-hr:border-t prose-hr:border-b-0 prose-table:my-0 prose-thead:border-b prose-thead:border-border prose-th:bg-muted/40 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-medium prose-th:text-foreground prose-td:px-3 prose-td:py-2 prose-td:align-top prose-td:text-foreground/80 prose-tr:border-b prose-tr:border-border prose-tr:last:border-b-0 max-w-none dark:prose-invert [&_u]:underline [&_s]:line-through [&_del]:line-through [&_strike]:line-through [&_pre]:max-w-full [&_pre]:overflow-x-auto";

  // The parse runs inside ReactMarkdown's render, so the element is memoized
  // and handed back unchanged while the source and components hold. React
  // then skips that subtree, and a state change elsewhere on the page no
  // longer re-parses every message on screen. A room transcript with a
  // hundred or two messages felt that on every keystroke and every jump.
  const rendered = useMemo(() => {
    const highlightedChildren = applyMarkdownHighlighting(children, {
      term: highlightTerm,
    });
    const normalizedChildren =
      normalizeLooseInlineMarkdown(highlightedChildren);
    const sanitizedChildren = sanitizeMarkdown(normalizedChildren);
    // Display-only: bare domains → markdown links; room message body stays
    // plain.
    const linkifiedChildren = linkifyBareDomainsInMarkdown(sanitizedChildren);
    return (
      <ReactMarkdown
        remarkPlugins={[
          remarkBreaks,
          remarkGfm,
          [remarkEmoji, { emoticon: true }],
        ]}
        rehypePlugins={[rehypeRaw, rehypeMarkdownCodeHighlight]}
        components={components}
      >
        {linkifiedChildren}
      </ReactMarkdown>
    );
  }, [children, components, highlightTerm]);

  return (
    <div className={cn(baseTypographyClassName, className)}>
      <style href="sokosumi-markdown-highlight" precedence="default">
        {markdownHighlightThemeCss}
      </style>
      {rendered}
    </div>
  );
}
