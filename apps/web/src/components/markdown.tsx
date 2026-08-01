import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { applyMarkdownHighlighting } from "@/components/markdown-highlight";
import { cn } from "@/lib/utils";
import { normalizeLooseInlineMarkdown } from "@/lib/utils/composer-markdown-dom";
import { sanitizeMarkdown } from "@/lib/utils/sanitizeMarkdown";

function isSokosumiLink(href: string | undefined): boolean {
  if (!href || href.startsWith("#")) return true;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
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

interface MarkdownProps {
  children: string;
  className?: string | undefined;
  highlightTerm?: string | undefined;
}

export default function Markdown({
  children,
  className,
  highlightTerm,
}: MarkdownProps) {
  const highlightedChildren = applyMarkdownHighlighting(children, {
    term: highlightTerm,
  });
  const normalizedChildren = normalizeLooseInlineMarkdown(highlightedChildren);
  const sanitizedChildren = sanitizeMarkdown(normalizedChildren);

  const components: Components = {
    a: ({ href, children, ...props }) => {
      const sameTab = isSokosumiLink(href);
      return (
        <a
          href={href}
          {...props}
          {...(sameTab ? {} : { target: "_blank", rel: "noopener noreferrer" })}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, ...props }) => {
      const srcString = typeof src === "string" ? src : undefined;
      const isVideo = srcString?.match(/\.(mp4|webm|ogg)$/i);

      if (isVideo && srcString) {
        return (
          <video
            src={srcString}
            controls
            className="w-full max-w-3xl rounded-lg"
          >
            <source src={srcString} type="video/mp4" />
            {"Your browser does not support the video tag."}
            <a href={srcString}>{"Download video"}</a>
          </video>
        );
      }

      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="max-w-full rounded-lg" {...props} />
      );
    },
    video: ({ children, ...props }) => (
      <video {...props} className="w-full max-w-3xl rounded-lg" controls>
        {children}
      </video>
    ),
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
      const codeText = String(children ?? "");
      const isInline =
        !className?.includes("language-") && !codeText.includes("\n");

      if (isInline) {
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
  };

  const baseTypographyClassName =
    "wrap-anywhere prose prose-sm prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-h4:text-sm prose-h5:text-sm prose-h6:text-sm prose-p:my-2 prose-p:leading-relaxed prose-p:text-foreground/80 prose-strong:font-bold prose-strong:text-foreground prose-em:italic prose-ul:my-2 prose-ul:list-disc prose-ul:ps-6 prose-ol:my-2 prose-ol:list-decimal prose-ol:ps-6 prose-li:my-1 prose-li:ps-1 prose-li:marker:text-muted-foreground prose-li:text-foreground/80 prose-a:text-primary prose-a:font-medium prose-a:underline prose-a:underline-offset-4 prose-a:decoration-primary/40 hover:prose-a:decoration-primary prose-pre:my-3 prose-pre:rounded-md prose-pre:border prose-pre:border-border prose-pre:bg-muted/40 prose-pre:px-4 prose-pre:py-3 prose-pre:text-sm prose-pre:leading-6 prose-pre:font-normal prose-pre:[tab-size:2] prose-pre:[text-wrap:pretty] prose-blockquote:my-3 prose-hr:my-4 prose-hr:border-border prose-hr:border-t prose-hr:border-b-0 prose-table:my-0 prose-thead:border-b prose-thead:border-border prose-th:bg-muted/40 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-medium prose-th:text-foreground prose-td:px-3 prose-td:py-2 prose-td:align-top prose-td:text-foreground/80 prose-tr:border-b prose-tr:border-border prose-tr:last:border-b-0 max-w-none dark:prose-invert [&_u]:underline [&_s]:line-through [&_del]:line-through [&_strike]:line-through [&_pre]:max-w-full [&_pre]:overflow-x-auto";

  return (
    <div className={cn(baseTypographyClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkBreaks, remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeHighlight, { detect: true }]]}
        components={components}
      >
        {sanitizedChildren}
      </ReactMarkdown>
    </div>
  );
}
