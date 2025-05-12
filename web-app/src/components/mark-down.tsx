import DefaultMarkdown, { MarkdownToJSX } from "markdown-to-jsx";

interface MarkDownProps {
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

export default function MarkDown({
  children,
  options = defaultOptions,
  className,
}: MarkDownProps) {
  return (
    <DefaultMarkdown options={options} className={className}>
      {children}
    </DefaultMarkdown>
  );
}
