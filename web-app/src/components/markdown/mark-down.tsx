import Markdown, { MarkdownToJSX } from "markdown-to-jsx";

interface MyMarkDownProps {
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

export default function MyMarkDown({
  children,
  options = defaultOptions,
  className,
}: MyMarkDownProps) {
  return (
    <Markdown options={options} className={className}>
      {children}
    </Markdown>
  );
}
