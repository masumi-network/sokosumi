"use server";

import { readFile } from "fs/promises";

import Markdown from "./markdown";

export interface MarkdownFileProps {
  fileSystemPath: string;
}

export default async function MarkdownFile({
  fileSystemPath,
}: MarkdownFileProps) {
  const markdownContent = await readFile(fileSystemPath, "utf8");

  return (
    <section className="max-w-full p-4 pt-8 md:mx-auto md:max-w-2/3 xl:max-w-1/2">
      <Markdown>{markdownContent}</Markdown>
    </section>
  );
}
