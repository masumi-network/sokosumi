import DefaultMarkdown, { MarkdownToJSX } from "markdown-to-jsx";

interface MarkdownProps {
  children: string;
  options?: MarkdownToJSX.Options | undefined;
  className?: string | undefined;
}

const defaultOptions: MarkdownToJSX.Options = {
  disableParsingRawHTML: true,
  wrapper: ({ children }) => (
    <div className="prose dark:prose-invert">{children}</div>
  ),
  forceWrapper: true,
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
