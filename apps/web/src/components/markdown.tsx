import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { applyMarkdownHighlighting } from "@/components/markdown-highlight";
import { cn } from "@/lib/utils";
import { sanitizeMarkdown } from "@/lib/utils/sanitizeMarkdown";

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
  const sanitizedChildren = sanitizeMarkdown(highlightedChildren);

  const components: Components = {
    a: ({ href, children, ...props }) => (
      <a href={href} {...props} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
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
    table: ({ children, ...props }) => (
      <div className="overflow-x-auto">
        <table {...props} className="w-full min-w-full">
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
    "prose prose-sm prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-h4:text-sm prose-h5:text-sm prose-h6:text-sm prose-p:my-2 prose-p:leading-relaxed prose-p:text-foreground/80 prose-strong:text-foreground prose-li:my-1 prose-ul:my-2 prose-ol:my-2 prose-a:text-primary prose-a:font-medium prose-a:underline prose-a:underline-offset-4 prose-a:decoration-primary/40 hover:prose-a:decoration-primary prose-pre:my-3 prose-blockquote:my-3 max-w-none dark:prose-invert";

  return (
    <div className={cn(baseTypographyClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkBreaks, remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {sanitizedChildren}
      </ReactMarkdown>
    </div>
  );
}
