import DefaultMarkdown, { MarkdownToJSX } from "markdown-to-jsx";

import { applyMarkdownHighlighting } from "@/components/markdown-highlight";
import { sanitizeMarkdown } from "@/lib/utils/sanitizeMarkdown";

interface MarkdownProps {
  children: string;
  options?: MarkdownToJSX.Options | undefined;
  className?: string | undefined;
  highlightTerm?: string | undefined;
}

const defaultOptions: MarkdownToJSX.Options = {
  disableParsingRawHTML: false,
  wrapper: ({ children }) => (
    <article className="prose dark:prose-invert max-w-none">{children}</article>
  ),
  forceWrapper: true,
  overrides: {
    a: {
      component: ({ children, ...props }) => (
        <a {...props} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    },
    img: {
      component: ({ alt, src, ...props }) => {
        const isVideo = src?.match(/\.(mp4|webm|ogg)$/i);

        if (isVideo) {
          return (
            <video
              src={src}
              controls
              {...props}
              className="w-full max-w-3xl rounded-lg"
            >
              <source src={src} type="video/mp4" />
              {"Your browser does not support the video tag."}
              <a href={src}>{"Download video"}</a>
            </video>
          );
        }

        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={alt}
            src={src}
            {...props}
            className="max-w-full rounded-lg"
          />
        );
      },
    },
    video: {
      component: ({ children, ...props }) => (
        <video {...props} className="w-full max-w-3xl rounded-lg" controls>
          {children}
        </video>
      ),
    },
    table: {
      component: ({ children, ...props }) => (
        <div className="overflow-x-auto">
          <table {...props} className="w-full min-w-full">
            {children}
          </table>
        </div>
      ),
    },
  },
};

export default function Markdown({
  children,
  options = defaultOptions,
  className,
  highlightTerm,
}: MarkdownProps) {
  const highlightedChildren = applyMarkdownHighlighting(children, {
    term: highlightTerm,
  });
  const sanitizedChildren = sanitizeMarkdown(highlightedChildren);

  return (
    <DefaultMarkdown options={options} className={className}>
      {sanitizedChildren}
    </DefaultMarkdown>
  );
}
