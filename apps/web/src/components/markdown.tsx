import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
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
  };

  return (
    <div className={cn("prose dark:prose-invert max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {sanitizedChildren}
      </ReactMarkdown>
    </div>
  );
}
