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
    // Ensure bold text stays as bold, not headings - prevent it from being styled like headings
    strong: ({ children, ...props }) => (
      <strong {...props} className="font-semibold text-inherit">
        {children}
      </strong>
    ),
    // Prevent headings from being too large - limit their size
    h1: ({ children, ...props }) => (
      <h1 {...props} className="my-2 text-base font-semibold first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2 {...props} className="my-2 text-base font-semibold first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 {...props} className="my-2 text-sm font-semibold first:mt-0">
        {children}
      </h3>
    ),
    // Handle line breaks with proper spacing
    br: () => <br className="block h-3" />,
    // Ensure paragraphs have proper spacing
    p: ({ children, ...props }) => (
      <p {...props} className="my-2 leading-relaxed first:mt-0 last:mb-0">
        {children}
      </p>
    ),
  };

  return (
    <div className={cn("prose dark:prose-invert max-w-none", className)}>
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
