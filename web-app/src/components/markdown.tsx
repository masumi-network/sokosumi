import DefaultMarkdown, { MarkdownToJSX } from "markdown-to-jsx";

interface MarkdownProps {
  children: string;
  options?: MarkdownToJSX.Options | undefined;
  className?: string | undefined;
}

const defaultOptions: MarkdownToJSX.Options = {
  disableParsingRawHTML: true,
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
  },
};

export default function Markdown({
  children,
  options = defaultOptions,
  className,
}: MarkdownProps) {
  return (
    <DefaultMarkdown options={options} className={className}>
      {children}
    </DefaultMarkdown>
  );
}
