import { readFile } from "fs/promises";
import Markdown from "markdown-to-jsx";

export interface MarkdownFileProps {
  filePath: string;
}

export default async function MarkdownFile({ filePath }: MarkdownFileProps) {
  const markdownContent = await readFile(filePath, "utf8");

  return (
    <section className="prose dark:prose-invert max-w-full p-4 pt-8 md:mx-auto md:max-w-2/3 xl:max-w-1/2">
      <Markdown>{markdownContent}</Markdown>
    </section>
  );
}
