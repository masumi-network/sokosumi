import { MarkdownFileType, readMarkdownFileContent } from "@/lib/data/markdown";

import Markdown from "./markdown";

export interface MarkdownFileProps {
  fileType: MarkdownFileType;
}

export default async function MarkdownFile({ fileType }: MarkdownFileProps) {
  const markdownContent = await readMarkdownFileContent(fileType);

  return (
    <section className="max-w-full p-4 pt-8 md:mx-auto md:max-w-2/3 xl:max-w-1/2">
      <Markdown>{markdownContent}</Markdown>
    </section>
  );
}
